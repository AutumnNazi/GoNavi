import { describe, expect, it } from 'vitest';

import {
  isTruncatedPreviewValue,
  omitTruncatedPatchEntries,
  stripTruncatedPasteValues,
} from './dataGridTruncatedValue';
import { isWritableResultCellValue } from './rowLocator';

describe('isTruncatedPreviewValue', () => {
  // 移植陷阱：yxdb 是后缀式 '...[truncated]'，GoNavi 后端是前缀式
  // '[TEXT preview: N/M bytes] '，必须按前缀识别——用 endsWith 实现会恒为 false。
  it('识别后端全部前缀式截断标记', () => {
    expect(isTruncatedPreviewValue('[TEXT preview: 1048576/2097152 bytes] abcdef')).toBe(true);
    expect(isTruncatedPreviewValue('[BINARY preview: 1048576/2097152 bytes] 0xdeadbeef')).toBe(true);
    expect(isTruncatedPreviewValue('[JSON preview: 1048576/2097152 bytes] {"a":1}')).toBe(true);
    // Oracle 大对象预览分支（4KiB 阈值）走另一处 Sprintf，同样要覆盖
    expect(isTruncatedPreviewValue('[CLOB preview: 4096/9362 bytes] select * from t')).toBe(true);
    expect(isTruncatedPreviewValue('[BLOB preview: 4096/9362 bytes] 0x00ff')).toBe(true);
  });

  it('容忍大小写与多余空格', () => {
    expect(isTruncatedPreviewValue('[text preview: 10/20 bytes] x')).toBe(true);
    expect(isTruncatedPreviewValue('[TEXT preview:10/20 bytes] x')).toBe(true);
    expect(isTruncatedPreviewValue('[TEXT preview: 10 / 20 bytes] x')).toBe(true);
  });

  it('不误判普通字符串', () => {
    expect(isTruncatedPreviewValue('abc')).toBe(false);
    expect(isTruncatedPreviewValue('')).toBe(false);
    // 标记必须在开头：出现在中间说明不是后端产出的预览值
    expect(isTruncatedPreviewValue('prefix [TEXT preview: 10/20 bytes] x')).toBe(false);
    // yxdb 的后缀式标记在 GoNavi 后端根本不存在，不应被识别
    expect(isTruncatedPreviewValue('abc...[truncated]')).toBe(false);
    // 形近但格式不符：缺少 bytes 段
    expect(isTruncatedPreviewValue('[TEXT preview: 10/20] x')).toBe(false);
  });

  it('不误判非字符串值', () => {
    expect(isTruncatedPreviewValue(null)).toBe(false);
    expect(isTruncatedPreviewValue(undefined)).toBe(false);
    expect(isTruncatedPreviewValue(123)).toBe(false);
    expect(isTruncatedPreviewValue({})).toBe(false);
    expect(isTruncatedPreviewValue(['[TEXT preview: 10/20 bytes] x'])).toBe(false);
  });

  // 逐字对照后端 Sprintf 产出（internal/db/scan_rows.go:178/183/190 与 :363/:373），
  // 数字位来自 Go 的 %d（无千分位分隔符），BINARY 分支首个数是 maxBytes、第二个是 len(typed)。
  it('逐字匹配后端 Sprintf 实际产出', () => {
    expect(isTruncatedPreviewValue('[TEXT preview: 1048576/3145728 bytes] hello')).toBe(true);
    expect(isTruncatedPreviewValue('[BINARY preview: 1048576/3145728 bytes] 0x89504e47')).toBe(true);
    expect(isTruncatedPreviewValue('[JSON preview: 1048576/3145728 bytes] {"k":"v"}')).toBe(true);
    // Oracle：首个数是阈值常量 interactiveOracleLargeObjectPreviewBytes，第二个是真实长度
    expect(isTruncatedPreviewValue('[CLOB preview: 4096/10485760 bytes] create or replace')).toBe(true);
    expect(isTruncatedPreviewValue('[BLOB preview: 4096/2097152 bytes] 0x1f8b')).toBe(true);
  });

  it('预览内容为空或含换行时仍识别（只看标记段）', () => {
    expect(isTruncatedPreviewValue('[TEXT preview: 0/100 bytes] ')).toBe(true);
    expect(isTruncatedPreviewValue('[TEXT preview: 10/20 bytes] \nline2')).toBe(true);
    expect(isTruncatedPreviewValue('[JSON preview: 10/20 bytes]')).toBe(true);
  });

  // 误判方向是刻意选定的安全侧：用户原文恰好以标记开头会被拦成不可编辑，
  // 代价只是该格不可改，而漏判的代价是把截断文本写回覆盖数据库原始 LOB。
  it('原文恰好以标记开头时按安全侧拦截（已知误判方向，非缺陷）', () => {
    expect(isTruncatedPreviewValue('[TEXT preview: 1/2 bytes] 用户自己写的日志行')).toBe(true);
  });

  it('相似但不合法的写法不拦截，避免过度封锁正常编辑', () => {
    // 类型名不在后端枚举内
    expect(isTruncatedPreviewValue('[TEXTURE preview: 10/20 bytes] x')).toBe(false);
    // 缺 bytes 段
    expect(isTruncatedPreviewValue('[TEXT preview: 10/20] x')).toBe(false);
    // 缺方括号闭合
    expect(isTruncatedPreviewValue('[TEXT preview: 10/20 bytes x')).toBe(false);
    // 数字段缺失
    expect(isTruncatedPreviewValue('[TEXT preview: /20 bytes] x')).toBe(false);
    // 前置空白使标记不在开头
    expect(isTruncatedPreviewValue(' [TEXT preview: 10/20 bytes] x')).toBe(false);
  });
});

describe('omitTruncatedPatchEntries', () => {
  it('剔除基准列为截断预览的条目并报告列名', () => {
    const baseRow = {
      id: 1,
      content: '[TEXT preview: 1048576/2097152 bytes] long',
      name: 'A',
    };

    const { patch, skippedColumns } = omitTruncatedPatchEntries(
      { content: '用户新输入', name: 'B' },
      baseRow,
    );

    expect(patch).toEqual({ name: 'B' });
    expect(skippedColumns).toEqual(['content']);
  });

  it('基准行缺失时原样保留（无法判定即不拦截编辑）', () => {
    expect(omitTruncatedPatchEntries({ name: 'B' }, undefined).patch).toEqual({ name: 'B' });
    expect(omitTruncatedPatchEntries({ name: 'B' }, null).skippedColumns).toEqual([]);
  });

  it('基准行存在但该列非截断值时保留条目', () => {
    const { patch, skippedColumns } = omitTruncatedPatchEntries({ extra: 'x' }, { name: 'A' });

    expect(patch).toEqual({ extra: 'x' });
    expect(skippedColumns).toEqual([]);
  });

  it('剔除同批次的多列截断条目', () => {
    const { patch, skippedColumns } = omitTruncatedPatchEntries(
      { a: '1', b: '2', c: '3' },
      {
        a: '[TEXT preview: 10/20 bytes] x',
        b: '[BLOB preview: 10/20 bytes] 0x',
        c: 'ok',
      },
    );

    expect(patch).toEqual({ c: '3' });
    expect(skippedColumns).toEqual(['a', 'b']);
  });
});

describe('stripTruncatedPasteValues', () => {
  const resolveFromBase = (base: Record<string, Record<string, any>>) => (
    (rowKey: string, column: string) => base[rowKey]?.[column]
  );

  it('跳过目标格当前值为截断预览的写入项并同步扣减计数', () => {
    const result = {
      updatedCellCount: 2,
      rows: [{
        rowKey: 'row-1',
        values: { content: 'pasted', name: 'B' },
        modifiedValues: { content: 'pasted', name: 'B' },
        modifiedColumnNames: ['content', 'name'],
      }],
    };

    const stripped = stripTruncatedPasteValues(
      result,
      resolveFromBase({ 'row-1': { content: '[TEXT preview: 10/20 bytes] x', name: 'A' } }),
    );

    expect(stripped.rows[0].values).toEqual({ name: 'B' });
    // modifiedValues 是提交给 setModifiedRows 的权威 patch，必须一并剔除，否则守卫被绕过
    expect(stripped.rows[0].modifiedValues).toEqual({ name: 'B' });
    expect(stripped.rows[0].modifiedColumnNames).toEqual(['name']);
    expect(stripped.updatedCellCount).toBe(1);
    expect(stripped.skippedCellCount).toBe(1);
    expect(stripped.skippedColumns).toEqual(['content']);
  });

  it('无截断格时原样透传，updatedCellCount 与传入值一致', () => {
    const result = {
      updatedCellCount: 1,
      rows: [{ rowKey: 'row-1', values: { name: 'B' } }],
    };

    const stripped = stripTruncatedPasteValues(result, resolveFromBase({ 'row-1': { name: 'A' } }));

    expect(stripped.rows).toEqual(result.rows);
    expect(stripped.updatedCellCount).toBe(1);
    expect(stripped.skippedCellCount).toBe(0);
    expect(stripped.skippedColumns).toEqual([]);
  });

  it('目标格当前值缺失时不拦截（新增行等场景）', () => {
    const result = {
      updatedCellCount: 1,
      rows: [{ rowKey: 'added-row', values: { name: 'B' } }],
    };

    const stripped = stripTruncatedPasteValues(result, resolveFromBase({}));

    expect(stripped.rows[0].values).toEqual({ name: 'B' });
    expect(stripped.skippedCellCount).toBe(0);
  });
});

describe('isWritableResultCellValue（rowLocator 侧的可写判定守卫）', () => {
  it('普通值在可写列上仍可写', () => {
    expect(isWritableResultCellValue('content', 'abc')).toBe(true);
    expect(isWritableResultCellValue('content', 42)).toBe(true);
    expect(isWritableResultCellValue('content', null)).toBe(true);
  });

  it('截断预览值判定为不可写', () => {
    expect(isWritableResultCellValue('content', '[TEXT preview: 1048576/2097152 bytes] long')).toBe(false);
    expect(isWritableResultCellValue('content', '[CLOB preview: 4096/9362 bytes] ddl')).toBe(false);
  });

  it('本身不可写的列不受值影响', () => {
    const readOnlyLocator = {
      strategy: 'none' as const,
      columns: [],
      valueColumns: [],
      readOnly: true,
    };

    expect(isWritableResultCellValue('content', 'abc', readOnlyLocator)).toBe(true);
    // 隐藏定位列（Oracle rowid 等）始终不可写，与值无关
    const hiddenLocator = {
      strategy: 'oracle-rowid' as const,
      columns: ['ROWID'],
      valueColumns: ['__gonavi_oracle_rowid__'],
      hiddenColumns: ['__gonavi_oracle_rowid__'],
      readOnly: false,
    };
    expect(isWritableResultCellValue('__gonavi_oracle_rowid__', 'AAA', hiddenLocator)).toBe(false);
  });
});

// 行编辑器（row editor）直填路径的守卫：applyRowEditor 从表单取值后直接 setModifiedRows，
// 不经过 handleCellSave，必须自己剔除基准列为截断预览的条目（等价 yxdb DataGrid.tsx 的
// applyRowEditor 内联守卫）。这里按 applyRowEditor 的实际调用形态做纯函数级用例：
// 只把「与基准行有实际差异」的列放进 builtPatch，再交给 omitTruncatedPatchEntries。
describe('行编辑器直填路径守卫（applyRowEditor 同形调用）', () => {
  // 复现 applyRowEditor 组装 builtPatch 的口径：可写列 + 值确有变更才入 patch
  const buildRowEditorPatch = (
    formValues: Record<string, any>,
    baseRawMap: Record<string, any>,
    isWritableColumn: (col: string) => boolean = () => true,
  ): Record<string, any> => {
    const patch: Record<string, any> = {};
    Object.keys(formValues).forEach((col) => {
      if (!isWritableColumn(col)) return;
      if (formValues[col] !== baseRawMap[col]) patch[col] = formValues[col];
    });
    return patch;
  };

  it('基准列为截断预览时剔除该列，其余列正常写回', () => {
    const baseRawMap = {
      id: 1,
      content: '[TEXT preview: 1048576/2097152 bytes] 完整值的前 1MiB',
      name: 'A',
    };
    const formValues = { id: 1, content: '用户改过的内容', name: 'B' };

    const built = buildRowEditorPatch(formValues, baseRawMap);
    // 未加守卫时 content 会进 patch —— 这正是要拦住的写回
    expect(built).toHaveProperty('content');

    const { patch, skippedColumns } = omitTruncatedPatchEntries(built, baseRawMap);

    expect(patch).toEqual({ name: 'B' });
    expect(skippedColumns).toEqual(['content']);
  });

  it('用户未改动截断格时不产生跳过计数（不弹无意义的提示）', () => {
    const baseRawMap = { content: '[CLOB preview: 4096/9362 bytes] ddl...', name: 'A' };
    // content 原样回填：builtPatch 里没有它，跳过计数应为 0
    const built = buildRowEditorPatch({ content: baseRawMap.content, name: 'B' }, baseRawMap);

    const { patch, skippedColumns } = omitTruncatedPatchEntries(built, baseRawMap);

    expect(patch).toEqual({ name: 'B' });
    expect(skippedColumns).toEqual([]);
  });

  it('改动多列截断格时全部剔除并按列数计数', () => {
    const baseRawMap = {
      content: '[TEXT preview: 1048576/2097152 bytes] x',
      payload: '[JSON preview: 1048576/2097152 bytes] {"a":1}',
      name: 'A',
    };
    const built = buildRowEditorPatch(
      { content: 'c', payload: 'p', name: 'B' },
      baseRawMap,
    );

    const { patch, skippedColumns } = omitTruncatedPatchEntries(built, baseRawMap);

    expect(patch).toEqual({ name: 'B' });
    expect(skippedColumns).toHaveLength(2);
    expect(skippedColumns).toEqual(expect.arrayContaining(['content', 'payload']));
  });

  it('全部改动列均为截断格时 patch 为空（调用方据此删除该行 modifiedRows 条目）', () => {
    const baseRawMap = { content: '[TEXT preview: 1048576/2097152 bytes] x' };
    const built = buildRowEditorPatch({ content: '新内容' }, baseRawMap);

    const { patch, skippedColumns } = omitTruncatedPatchEntries(built, baseRawMap);

    expect(patch).toEqual({});
    expect(Object.keys(patch)).toHaveLength(0);
    expect(skippedColumns).toEqual(['content']);
  });
});
