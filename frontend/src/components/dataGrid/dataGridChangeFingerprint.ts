/*
 * dataGridChangeFingerprint.ts — 结果集变更指纹（增量比较）
 *
 * 背景：DataGrid 通过 onDataChange 向外上报输出行，需要先判断"输出行是否真的变了"。
 * 原先实现无条件 `JSON.stringify(outputRows)`：10W 行级结果集下每次行内编辑都会把
 * 整个结果集重新序列化一遍，成本与结果集体量线性相关，主线程阻塞可达百 ms 级。
 *
 * 策略（分级）：
 *  - 行数 <= DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS：全量 JSON.stringify，
 *    与原行为完全一致（小结果集不引入任何行为差异，零回归风险）。
 *  - 行数 > 阈值：均匀抽样 N 行 + 行数 + 输出列名 + 修改集 + 删除集 拼成指纹。
 *    抽样未命中的修改由 modifiedRows / deletedRowKeys 兜底覆盖 —— 这两个集合是
 *    行内容变化的唯一来源，因此不会漏报。
 */

/** 超过该行数改用抽样指纹，避免大结果集全量序列化。 */
export const DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS = 2000;
/** 抽样指纹的采样行数。 */
export const DATA_GRID_FINGERPRINT_SAMPLE_COUNT = 64;

/**
 * 构造输出行的变更指纹。
 *
 * @param rows               本次待上报的输出行
 * @param modifiedRows       行内编辑产生的新值（行键 -> 列补丁）
 * @param deletedRowKeys     待删除的行键集合
 * @param outputColumnNames  输出列名（列集合变化也必须视为变更）
 */
export const buildDataGridIncrementalFingerprint = (
    rows: unknown[],
    modifiedRows: Record<string, Record<string, any>>,
    deletedRowKeys: Set<string>,
    outputColumnNames: string[],
): string => {
    if (rows.length <= DATA_GRID_FINGERPRINT_FULL_STRINGIFY_MAX_ROWS) {
        return JSON.stringify(rows);
    }
    const parts: unknown[] = [rows.length, outputColumnNames];
    const sampleCount = Math.min(DATA_GRID_FINGERPRINT_SAMPLE_COUNT, rows.length);
    const step = rows.length / sampleCount;
    for (let i = 0; i < sampleCount; i += 1) {
        parts.push(rows[Math.floor(i * step)]);
    }
    parts.push(modifiedRows, Array.from(deletedRowKeys));
    return JSON.stringify(parts);
};
