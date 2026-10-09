/**
 * 补全 / hover 专用的「有界 SQL 语句上下文」（性能专项）
 *
 * 旧实现（sqlCompletionStatementContext.ts）对 `model.getValue()` 的**全文**跑
 * findSqlStatementRanges 定位当前语句。问题不在于词法扫描本身，而在于语句边界的判定方式：
 * 「上一行没写分号」时当前语句会一路回溯到文档开头，于是每次触发补全都要对整篇文档做一次
 * 词法扫描 + 后续的别名/表引用扫描，耗时随文档体积线性增长（大 SQL 下每次按键都付一遍）。
 *
 * 这里有界化的做法：只在光标附近「向上 N 行 / 向下 M 行、遇空行截断」的窗口内定位语句边界。
 * 窗口仍覆盖同一语句的 FROM/JOIN 部分（所以别名解析不受影响），但扫描量不随文档体积增长。
 *
 * ⚠️ 与执行路径的关系：`utils/sqlStatementSelection.ts` 的 resolveCurrentSqlStatementRange
 * 是**执行路径也在用**的公共函数（决定实际跑哪条语句），本模块**不修改也不替换**它——
 * 只在窗口文本上复用同源的 findSqlStatementRanges 词法扫描，执行语义零影响。
 */

import { findSqlStatementRanges } from '../../utils/sqlStatementSelection';

// 补全/hover 的「有界语句上下文」窗口上限：
// 向上最多回看 200 行、向下最多前瞻 100 行，遇空行即视为语句硬边界。
export const QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKBACK_LINES = 200;
export const QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKAHEAD_LINES = 100;

/** 有界语句上下文：所有文本均已做 \r\n → \n 规范化。 */
export interface BoundedSqlStatementContext {
    /** 当前语句起点 → 光标 的前缀文本（无分号时只回溯到最近分号/空行/窗口顶）。 */
    prefixText: string;
    /** 当前语句的有界全文（含光标之后的语句剩余部分，供 FROM/JOIN 别名解析）。 */
    statementText: string;
    /** 供表引用/别名扫描的参照文本：statementText 优先，为空时退化为 prefixText。 */
    referenceText: string;
}

/** 上一行行首偏移；已是文档开头返回 -1。 */
const findPreviousSqlLineStart = (text: string, lineStart: number): number => {
    if (lineStart <= 0) return -1;
    let index = lineStart - 1;
    if (text[index] === '\n') index--;
    while (index >= 0 && text[index] !== '\n') index--;
    return index + 1;
};

/**
 * 解析光标处的 SQL 语句上下文（有界版）。
 *
 * 窗口内复用完整的分号/引号/注释/PLSQL 词法扫描，因此窗口内的判定结果与全文扫描一致；
 * 只有「语句本身跨过整个窗口」这一种情况会与全文扫描不同，而那正是要放弃的极端长语句。
 */
export const resolveBoundedSqlStatementContext = (
    sql: string,
    cursorOffset: number,
    dbType = '',
): BoundedSqlStatementContext => {
    const empty: BoundedSqlStatementContext = { prefixText: '', statementText: '', referenceText: '' };
    const raw = String(sql || '');
    if (!raw) return empty;
    // 仅在确实含 CRLF 时才整体替换，避免无谓的全文拷贝（Monaco getValue 通常只有 \n）。
    const text = raw.includes('\r') ? raw.replace(/\r\n/g, '\n') : raw;
    const offset = Math.max(0, Math.min(text.length, Number.isFinite(cursorOffset) ? cursorOffset : 0));

    // 当前行行首
    let lineStart = offset;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;

    // 窗口起点：向上最多 LOOKBACK 行，遇空行（仅空白）停在其下一行
    let windowStart = lineStart;
    for (let i = 0; i < QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKBACK_LINES; i++) {
        const prevStart = findPreviousSqlLineStart(text, windowStart);
        if (prevStart < 0) break;
        if (!text.slice(prevStart, windowStart).trim()) break;
        windowStart = prevStart;
    }

    // 当前行行尾（不含换行符）
    let lineEnd = offset;
    while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++;

    // 窗口终点：向下最多 LOOKAHEAD 行，遇空行停在其上一行
    let windowEnd = lineEnd;
    for (let i = 0; i < QUERY_EDITOR_COMPLETION_CONTEXT_MAX_LOOKAHEAD_LINES; i++) {
        if (windowEnd >= text.length) break;
        const nextStart = windowEnd + 1; // 跳过 '\n'
        if (nextStart > text.length) break;
        let nextEnd = nextStart;
        while (nextEnd < text.length && text[nextEnd] !== '\n') nextEnd++;
        if (!text.slice(nextStart, nextEnd).trim()) break;
        windowEnd = nextEnd;
    }

    const windowText = text.slice(windowStart, windowEnd);
    if (!windowText.trim()) return empty;
    const cursorInWindow = offset - windowStart;

    // 窗口内复用完整的分号/引号/注释/PLSQL 词法扫描定位语句边界，与全文扫描同源。
    const ranges = findSqlStatementRanges(windowText, dbType);
    if (ranges.length === 0) return empty;
    const containing = ranges.find((item) => cursorInWindow >= item.start && cursorInWindow <= item.end);
    const range = containing
        || ranges.find((item) => cursorInWindow < item.start)
        || ranges[ranges.length - 1];

    const prefixText = windowText.slice(range.start, cursorInWindow);
    const statementText = range.text || '';
    return {
        prefixText,
        statementText,
        referenceText: statementText || prefixText,
    };
};
