/* dataGridTruncatedValue.ts — 截断预览值守卫（数据完整性）
 *
 * 背景：后端在结果集超出预算时会把超大字段替换成**前缀式**预览标记，
 * 分两处产生（internal/db/scan_rows.go）：
 *   buildQueryFieldPreview（1MiB 阈值，queryEditorSafeMaxFieldBytes）
 *     "[TEXT preview: %d/%d bytes] %s" / "[BINARY preview: %d/%d bytes] 0x%x"
 *     "[JSON preview: %d/%d bytes] %s"
 *   Oracle LOB 预览分支（4KiB 阈值，interactiveOracleLargeObjectPreviewBytes）
 *     "[CLOB preview: %d/%d bytes] %s" / "[BLOB preview: %d/%d bytes] %s"
 *
 * 这类单元格里前端拿到的**不是完整值**。若用户在其上编辑并提交，patch 会把
 * 「预览标记 + 被截断的片段」写回数据库，**覆盖掉原始 LOB**。后端提交路径不做校验，
 * 因此必须由前端在写回前拦截。
 *
 * 误判方向：宁缺毋滥，一律取「阻止编辑」的安全侧——用户原文恰好以该前缀开头时会被
 * 误判为截断值，代价只是这一个格子不可编辑，不会产生数据损坏。
 */

/**
 * 截断预览标记的前缀正则。
 *
 * 刻意用**前缀**匹配而非 yxdb 的后缀式 endsWith：两边的标记形态不同，
 * 后端生成的是 `[TYPE preview: N/M bytes] ` 开头，后缀式实现将完全失效（恒为 false）。
 * \s* 与 /i 与仓库既有 CLOB_PREVIEW_PREFIX（databaseLinkDefinition.ts）保持一致，
 * 容忍后端格式微调（多余空格、大小写）。
 */
export const TRUNCATED_PREVIEW_PREFIX_PATTERN = /^\[(?:TEXT|BINARY|JSON|CLOB|BLOB) preview:\s*\d+\s*\/\s*\d+\s*bytes\]/i;

/**
 * 判断单元格值是否为后端截断后的预览值。
 *
 * 只判字符串：后端所有预览分支都经 fmt.Sprintf 产出**字符串**，[]byte 原始值在
 * 二进制分支同样被格式化成 "[BINARY preview: ...] 0x..." 字符串后才过 Wails 桥；
 * 未超限的 []byte 经 JSON 序列化成 base64，其字符集不含 '['，天然不会误命中前缀。
 */
export const isTruncatedPreviewValue = (value: unknown): boolean => (
  typeof value === 'string' && TRUNCATED_PREVIEW_PREFIX_PATTERN.test(value)
);

/**
 * 提交路径守卫（纯函数）：从待提交的 patch 中剔除「基准行对应列为截断预览值」的条目。
 *
 * 判据用**基准行的原始值**而非待写入值：截断信息只存在于从后端拿到的原始数据上，
 * 用户新输入的值不携带该信息。基准行缺失或对应列非截断值时条目原样保留。
 */
export const omitTruncatedPatchEntries = (
  patch: Record<string, any>,
  baseRow: Record<string, any> | null | undefined,
): { patch: Record<string, any>; skippedColumns: string[] } => {
  const nextPatch: Record<string, any> = {};
  const skippedColumns: string[] = [];
  Object.entries(patch || {}).forEach(([column, value]) => {
    if (baseRow && isTruncatedPreviewValue(baseRow[column])) {
      skippedColumns.push(column);
      return;
    }
    nextPatch[column] = value;
  });
  return { patch: nextPatch, skippedColumns };
};

type PasteRowLike = {
  rowKey: string;
  values: Record<string, any>;
  modifiedValues?: Record<string, any>;
  modifiedColumnNames?: string[];
};

/**
 * 粘贴路径守卫（纯函数）：剔除目标格的当前值为截断预览的写入项。
 *
 * 与 xlsx/批量填充同源：截断只可能出现在**当前已渲染的值**上，所以由调用方传入
 * resolveCurrentValue 复现「已新增行 → 已修改值 → 基准行」的取值优先级，
 * 避免本工具反向依赖 DataGrid 内部的行状态结构。
 *
 * updatedCellCount 会同步扣减被跳过的格子数，保证调用方据此判断「全部被跳过」时的
 * 提示文案正确。
 */
export const stripTruncatedPasteValues = <TRow extends PasteRowLike>(
  result: { rows: TRow[]; updatedCellCount: number },
  resolveCurrentValue: (rowKey: string, column: string) => unknown,
): { rows: TRow[]; updatedCellCount: number; skippedCellCount: number; skippedColumns: string[] } => {
  const skippedColumnNames = new Set<string>();
  let skippedCellCount = 0;
  let updatedCellCount = 0;

  const rows = (result?.rows || []).map((row) => {
    const skippedForRow = new Set<string>();
    const values: Record<string, any> = {};
    Object.entries(row.values || {}).forEach(([column, value]) => {
      if (isTruncatedPreviewValue(resolveCurrentValue(row.rowKey, column))) {
        skippedForRow.add(column);
        skippedColumnNames.add(column);
        skippedCellCount += 1;
        return;
      }
      values[column] = value;
      updatedCellCount += 1;
    });

    if (skippedForRow.size === 0) return row;

    // 同步剔除 modifiedValues/modifiedColumnNames：它们是提交给 setModifiedRows 的权威 patch，
    // 留着会让被拦截的列绕过守卫写回数据库；基准列为截断时该列本就不该有任何改动。
    const modifiedValues = row.modifiedValues
      ? Object.fromEntries(Object.entries(row.modifiedValues).filter(([column]) => !skippedForRow.has(column)))
      : row.modifiedValues;
    const modifiedColumnNames = row.modifiedColumnNames
      ? row.modifiedColumnNames.filter((column) => !skippedForRow.has(column))
      : row.modifiedColumnNames;

    // 泛型对象的展开覆写无法被 TS 证明可赋回 TRow（values 被放宽成 Record<string, any>），
    // 这里显式断言：运行时形态与入参一致，仅剔除了若干键。
    return { ...row, values, modifiedValues, modifiedColumnNames } as TRow;
  });

  // updatedCellCount 直接按保留下来的 values 条目重算：buildDataGridClipboardPasteRows
  // 正是「每接受一个写入项 +1」的同口径计数，因此无跳过时重算值与传入值恒等。
  return {
    rows,
    updatedCellCount,
    skippedCellCount,
    skippedColumns: Array.from(skippedColumnNames),
  };
};
