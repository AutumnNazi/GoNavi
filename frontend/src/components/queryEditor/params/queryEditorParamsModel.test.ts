import { describe, expect, it } from 'vitest';
import {
  bindingsFromValues,
  collectMissingParamNames,
  initialValuesFromSavedParams,
  paramStatementUsage,
} from './queryEditorParamsModel';

describe('collectMissingParamNames', () => {
  it('未出现在值表中的参数视为缺失', () => {
    const missing = collectMissingParamNames(['a', 'b'], {
      a: { type: 'string', value: 'v' },
    });
    expect(missing).toEqual(['b']);
  });

  it('空字符串与空列表视为缺失，NULL 类型视为已填', () => {
    const missing = collectMissingParamNames(['a', 'b', 'c'], {
      a: { type: 'string', value: '' },
      b: { type: 'null', value: null },
      c: { type: 'list', value: [] },
    });
    expect(missing).toEqual(['a', 'c']);
  });

  it('数字 0 与布尔 false 是有效值', () => {
    const missing = collectMissingParamNames(['a', 'b'], {
      a: { type: 'number', value: 0 },
      b: { type: 'boolean', value: false },
    });
    expect(missing).toEqual([]);
  });
});

describe('bindingsFromValues', () => {
  it('按分析参数顺序输出绑定，NULL 归一为 null 值', () => {
    const bindings = bindingsFromValues(['a', 'b'], {
      b: { type: 'null', value: null },
      a: { type: 'number', value: 3 },
    });
    expect(bindings).toEqual([
      { name: 'a', type: 'number', value: 3 },
      { name: 'b', type: 'null', value: null },
    ]);
  });

  it('忽略分析结果之外的参数', () => {
    const bindings = bindingsFromValues(['a'], {
      a: { type: 'string', value: 'v' },
      stale: { type: 'string', value: 'x' },
    });
    expect(bindings).toHaveLength(1);
  });
});

describe('initialValuesFromSavedParams', () => {
  it('用保存查询默认值预填会话输入', () => {
    const values = initialValuesFromSavedParams([
      { name: 'day', type: 'string', default: '2026-09-20' },
      { name: 'flag', type: 'boolean', default: true },
      { name: 'no_default', type: 'string' },
    ]);
    expect(values.day).toEqual({ type: 'string', value: '2026-09-20' });
    expect(values.flag).toEqual({ type: 'boolean', value: true });
    expect(values.no_default).toBeUndefined();
  });

  it('空声明返回空表', () => {
    expect(initialValuesFromSavedParams(null)).toEqual({});
    expect(initialValuesFromSavedParams([])).toEqual({});
  });
});

describe('paramStatementUsage', () => {
  it('记录参数出现的语句序号且去重', () => {
    const usage = paramStatementUsage([
      { index: 0, text: 'a', parameters: ['x', 'y'] },
      { index: 2, text: 'c', parameters: ['x'] },
    ]);
    expect(usage.x).toEqual([0, 2]);
    expect(usage.y).toEqual([0]);
  });
});
