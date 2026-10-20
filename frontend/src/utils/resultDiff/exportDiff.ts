import type { ResultDiffRow, ResultDiffSummary } from './types';
import { formatCellValue } from './client';
import { t } from '../../i18n';
import { buildSideBySideDocument, escapeResultDiffHtml as escapeHtml } from './resultDiffHtmlTemplate';

export type ResultDiffExportFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'html' | 'side_by_side';

export type ResultDiffExportMeta = {
  leftLabel: string;
  rightLabel: string;
  exportedAt?: string;
  filterNote?: string;
  /** 列类型映射，并排 HTML 表头展示 */
  columnMeta?: Record<string, { type?: string; comment?: string }>;
};

export type ResultDiffExportFlatRow = {
  kind: string;
  keys: string;
  changedFields: string;
  [col: string]: string;
};

const escapeCsvCell = (value: string, delimiter: string): string => {
  const needsQuote =
    value.includes(delimiter)
    || value.includes('"')
    || value.includes('\n')
    || value.includes('\r');
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

const joinKeys = (keys: Record<string, unknown> | undefined): string => {
  if (!keys) return '';
  return Object.entries(keys)
    .map(([k, v]) => `${k}=${formatCellValue(v)}`)
    .join('; ');
};

const joinChangedFields = (row: ResultDiffRow): string => {
  if (row.kind === 'changed' && row.changedFields?.length) {
    return row.changedFields
      .map((f) => `${f.name}: ${formatCellValue(f.left)} → ${formatCellValue(f.right)}`)
      .join(' | ');
  }
  return '';
};

/** 内部行键 / 客户端注入列，不参与预览与导出 */
export const isInternalResultDiffColumn = (name: string): boolean => {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return true;
  if (n === 'gonavi_row_key' || n === '__gonavi_row_key__' || n === '__gonavi_row_key') return true;
  if (n.startsWith('__gonavi_')) return true;
  return false;
};

/** 汇总可比较列（key + 公共变更列）；排除内部列 */
export const collectExportColumns = (
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
): string[] => {
  const cols: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const n = String(name || '').trim();
    if (!n || isInternalResultDiffColumn(n) || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    cols.push(n);
  };
  (summary.keyColumns || []).forEach(push);
  (summary.comparedColumns || []).forEach(push);
  (summary.commonColumns || []).forEach(push);
  for (const row of rows) {
    Object.keys(row.left || {}).forEach(push);
    Object.keys(row.right || {}).forEach(push);
    Object.keys(row.keys || {}).forEach(push);
  }
  return cols;
};

export const flattenDiffRow = (
  row: ResultDiffRow,
  dataColumns: string[],
): ResultDiffExportFlatRow => {
  const flat: ResultDiffExportFlatRow = {
    kind: String(row.kind || ''),
    keys: joinKeys(row.keys),
    changedFields: joinChangedFields(row),
  };
  for (const col of dataColumns) {
    const left = row.left?.[col];
    const right = row.right?.[col];
    if (row.kind === 'added') {
      flat[col] = formatCellValue(right);
      flat[`${col}__left`] = '';
      flat[`${col}__right`] = formatCellValue(right);
    } else if (row.kind === 'removed') {
      flat[col] = formatCellValue(left);
      flat[`${col}__left`] = formatCellValue(left);
      flat[`${col}__right`] = '';
    } else if (row.kind === 'changed') {
      const lv = formatCellValue(left);
      const rv = formatCellValue(right);
      flat[col] = lv === rv ? lv : `${lv} → ${rv}`;
      flat[`${col}__left`] = lv;
      flat[`${col}__right`] = rv;
    } else {
      flat[col] = formatCellValue(left ?? right);
      flat[`${col}__left`] = formatCellValue(left);
      flat[`${col}__right`] = formatCellValue(right);
    }
  }
  return flat;
};

export const buildSummaryText = (
  summary: ResultDiffSummary,
  meta: ResultDiffExportMeta,
): string => {
  const lines = [
    `Result Diff Export`,
    `Left: ${meta.leftLabel}`,
    `Right: ${meta.rightLabel}`,
    `Exported at: ${meta.exportedAt || new Date().toISOString()}`,
    meta.filterNote ? `Filter: ${meta.filterNote}` : '',
    '',
    `Added: ${summary.added}`,
    `Removed: ${summary.removed}`,
    `Changed: ${summary.changed}`,
    `Same: ${summary.same}`,
    `Unmatched: ${summary.unmatched}`,
    `Left rows: ${summary.leftRowCount}`,
    `Right rows: ${summary.rightRowCount}`,
    `Key columns: ${(summary.keyColumns || []).join(', ')}`,
  ];
  const heat = Object.entries(summary.changedColumnFreq || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => `  ${name}: ${count}`);
  if (heat.length) {
    lines.push('Changed field frequency:');
    lines.push(...heat);
  }
  return lines.filter((l) => l !== undefined).join('\n');
};

export const exportDiffAsDelimited = (
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
  delimiter: ',' | '\t',
  options?: { includeSideColumns?: boolean },
): string => {
  const dataColumns = collectExportColumns(summary, rows);
  const includeSide = Boolean(options?.includeSideColumns);
  const headers = ['kind', 'keys', 'changedFields'];
  for (const col of dataColumns) {
    if (includeSide) {
      headers.push(`${col}__left`, `${col}__right`);
    } else {
      headers.push(col);
    }
  }
  const lines = [headers.map((h) => escapeCsvCell(h, delimiter)).join(delimiter)];
  for (const row of rows) {
    const flat = flattenDiffRow(row, dataColumns);
    const cells = headers.map((h) => escapeCsvCell(String(flat[h] ?? ''), delimiter));
    lines.push(cells.join(delimiter));
  }
  // Excel 友好：CSV 加 BOM
  const body = lines.join('\n');
  return delimiter === ',' ? `\uFEFF${body}` : body;
};

export const exportDiffAsJson = (
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
  meta: ResultDiffExportMeta,
): string => {
  return JSON.stringify(
    {
      meta: {
        leftLabel: meta.leftLabel,
        rightLabel: meta.rightLabel,
        exportedAt: meta.exportedAt || new Date().toISOString(),
        filterNote: meta.filterNote || '',
      },
      summary,
      rows,
    },
    null,
    2,
  );
};

export const exportDiffAsMarkdown = (
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
  meta: ResultDiffExportMeta,
): string => {
  const dataColumns = collectExportColumns(summary, rows).slice(0, 12);
  const lines: string[] = [];
  lines.push(`# Result Diff`);
  lines.push('');
  lines.push(`- **Left**: ${meta.leftLabel}`);
  lines.push(`- **Right**: ${meta.rightLabel}`);
  lines.push(`- **Exported**: ${meta.exportedAt || new Date().toISOString()}`);
  if (meta.filterNote) lines.push(`- **Filter**: ${meta.filterNote}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Added | ${summary.added} |`);
  lines.push(`| Removed | ${summary.removed} |`);
  lines.push(`| Changed | ${summary.changed} |`);
  lines.push(`| Same | ${summary.same} |`);
  lines.push(`| Unmatched | ${summary.unmatched} |`);
  lines.push('');

  const heat = Object.entries(summary.changedColumnFreq || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (heat.length) {
    lines.push(`## Changed field frequency`);
    lines.push('');
    lines.push(`| Field | Count |`);
    lines.push(`| --- | ---: |`);
    heat.forEach(([name, count]) => lines.push(`| ${name} | ${count} |`));
    lines.push('');
  }

  lines.push(`## Rows (${rows.length})`);
  lines.push('');
  const headers = ['kind', 'keys', ...dataColumns, 'changedFields'];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    const flat = flattenDiffRow(row, dataColumns);
    const cells = headers.map((h) =>
      String(flat[h] ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' '),
    );
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
};

/** 单元格状态：same / left-only / right-only / changed */
export type SideCellMark = 'same' | 'removed' | 'added' | 'changed' | 'empty';

/** 并排预览与 HTML 导出共用的单元格解析 */
export const resolveSideCell = (
  row: ResultDiffRow,
  col: string,
  side: 'left' | 'right',
): { text: string; mark: SideCellMark } => {
  const left = row.left?.[col];
  const right = row.right?.[col];
  const lv = formatCellValue(left);
  const rv = formatCellValue(right);
  const hasLeft = row.left != null && Object.prototype.hasOwnProperty.call(row.left, col);
  const hasRight = row.right != null && Object.prototype.hasOwnProperty.call(row.right, col);

  if (row.kind === 'added') {
    if (side === 'left') return { text: '', mark: 'empty' };
    return { text: rv, mark: 'added' };
  }
  if (row.kind === 'removed') {
    if (side === 'right') return { text: '', mark: 'empty' };
    return { text: lv, mark: 'removed' };
  }
  if (row.kind === 'unmatched') {
    if (side === 'left') {
      return { text: hasLeft ? lv : '', mark: hasLeft ? 'removed' : 'empty' };
    }
    return { text: hasRight ? rv : '', mark: hasRight ? 'added' : 'empty' };
  }
  // changed / same
  if (lv === rv) {
    return { text: side === 'left' ? lv : rv, mark: 'same' };
  }
  if (side === 'left') return { text: lv, mark: 'changed' };
  return { text: rv, mark: 'changed' };
};

/**
 * 并排预览 HTML（类 Excel 左右对照 + 单元格着色）
 * - 左：改前 / Left
 * - 右：改后 / Right
 * - 行按 diff 结果对齐；单元格高亮 added/removed/changed
 */
export const exportDiffAsSideBySideHtml = (
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
  meta: ResultDiffExportMeta,
): string => {
  const dataColumns = collectExportColumns(summary, rows).slice(0, 40);
  const keyCols = summary.keyColumns || [];
  const colHeaders = [...keyCols.filter((c) => dataColumns.includes(c)), ...dataColumns.filter((c) => !keyCols.includes(c))];
  const cols = colHeaders.length > 0 ? colHeaders : dataColumns;

  const leftTitle = escapeHtml(meta.leftLabel || t('result_diff.wizard.left'));
  const rightTitle = escapeHtml(meta.rightLabel || t('result_diff.wizard.right'));

  const metaMap = meta.columnMeta || {};
  const headerLabel = (c: string): string => {
    const type = String(metaMap[c]?.type || Object.entries(metaMap).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1]?.type || '').trim();
    return type ? `${c}\n${type}` : c;
  };

  const renderSideTable = (side: 'left' | 'right', title: string): string => {
    const head = cols.map((c) => {
      const type = String(metaMap[c]?.type || Object.entries(metaMap).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1]?.type || '').trim();
      const label = type
        ? `<div class="col-name">${escapeHtml(c)}</div><div class="col-type">${escapeHtml(type)}</div>`
        : `<div class="col-name">${escapeHtml(c)}</div>`;
      return `<th title="${escapeHtml(headerLabel(c))}">${label}</th>`;
    }).join('');
    const body = rows
      .map((row, idx) => {
        const rowClass = `row-${escapeHtml(String(row.kind))}`;
        const kindCell = `<td class="kind-cell kind-${escapeHtml(String(row.kind))}">${escapeHtml(String(row.kind))}</td>`;
        const tds = cols
          .map((col) => {
            const cell = resolveSideCell(row, col, side);
            return `<td class="cell-${cell.mark}" title="${escapeHtml(cell.text)}">${escapeHtml(cell.text)}</td>`;
          })
          .join('');
        return `<tr class="${rowClass}" data-row="${idx + 1}"><td class="row-no">${idx + 1}</td>${kindCell}${tds}</tr>`;
      })
      .join('\n');
    return `
      <section class="pane pane-${side}">
        <header class="pane-header">
          <span class="pane-title">${title}</span>
          <span class="pane-count">${rows.length} rows</span>
        </header>
        <div class="table-scroll" data-side="${side}">
          <table>
            <thead>
              <tr>
                <th class="row-no">#</th>
                <th>kind</th>
                ${head}
              </tr>
            </thead>
            <tbody>
${body}
            </tbody>
          </table>
        </div>
      </section>`;
  };

  const heat = Object.entries(summary.changedColumnFreq || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([name, count]) => `<span class="heat-chip"><code>${escapeHtml(name)}</code>×${escapeHtml(count)}</span>`)
    .join('');

  return buildSideBySideDocument({
    summary,
    meta,
    leftTableHtml: renderSideTable('left', leftTitle),
    rightTableHtml: renderSideTable('right', rightTitle),
    heatHtml: heat,
  });
};

/** 列表式 HTML 报告（单表） */
export const exportDiffAsHtml = (
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
  meta: ResultDiffExportMeta,
): string => {
  const dataColumns = collectExportColumns(summary, rows).slice(0, 20);

  const heat = Object.entries(summary.changedColumnFreq || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => `<li><code>${escapeHtml(name)}</code>: ${count}</li>`)
    .join('');

  const headers = ['kind', 'keys', ...dataColumns, 'changedFields'];
  const headHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const bodyHtml = rows
    .map((row) => {
      const flat = flattenDiffRow(row, dataColumns);
      const kindClass = `kind-${escapeHtml(String(row.kind))}`;
      const tds = headers
        .map((h) => `<td class="${h === 'kind' ? kindClass : ''}">${escapeHtml(String(flat[h] ?? ''))}</td>`)
        .join('');
      return `<tr class="${kindClass}">${tds}</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Result Diff Export</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f1f1f; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
    .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .chip { padding: 4px 10px; border-radius: 999px; background: #f5f5f5; font-size: 13px; }
    .chip.added { background: #f6ffed; color: #389e0d; }
    .chip.removed { background: #fff1f0; color: #cf1322; }
    .chip.changed { background: #fffbe6; color: #d48806; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #e8e8e8; padding: 6px 8px; vertical-align: top; text-align: left; }
    th { background: #fafafa; position: sticky; top: 0; }
    tr.kind-added td.kind-added, .kind-added { color: #389e0d; }
    tr.kind-removed td.kind-removed, .kind-removed { color: #cf1322; }
    tr.kind-changed td.kind-changed, .kind-changed { color: #d48806; }
    code { font-size: 12px; }
  </style>
</head>
<body>
  <h1>Result Diff</h1>
  <div class="meta">
    <div>Left: ${escapeHtml(meta.leftLabel)}</div>
    <div>Right: ${escapeHtml(meta.rightLabel)}</div>
    <div>Exported: ${escapeHtml(meta.exportedAt || new Date().toISOString())}</div>
    ${meta.filterNote ? `<div>Filter: ${escapeHtml(meta.filterNote)}</div>` : ''}
  </div>
  <div class="summary">
    <span class="chip added">+${summary.added} added</span>
    <span class="chip removed">-${summary.removed} removed</span>
    <span class="chip changed">~${summary.changed} changed</span>
    <span class="chip">=${summary.same} same</span>
    <span class="chip">?${summary.unmatched} unmatched</span>
  </div>
  ${heat ? `<h2>Changed field frequency</h2><ul>${heat}</ul>` : ''}
  <h2>Rows (${rows.length})</h2>
  <table>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>
${bodyHtml}
    </tbody>
  </table>
</body>
</html>
`;
};

export const buildDiffExportContent = (
  format: ResultDiffExportFormat,
  summary: ResultDiffSummary,
  rows: ResultDiffRow[],
  meta: ResultDiffExportMeta,
): { content: string; mime: string; extension: string; filenameBase: string } => {
  const stamp = (meta.exportedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  const filenameBase = `result-diff-${stamp}`;
  switch (format) {
    case 'csv':
      return {
        content: exportDiffAsDelimited(summary, rows, ','),
        mime: 'text/csv;charset=utf-8',
        extension: 'csv',
        filenameBase,
      };
    case 'tsv':
      return {
        content: exportDiffAsDelimited(summary, rows, '\t'),
        mime: 'text/tab-separated-values;charset=utf-8',
        extension: 'tsv',
        filenameBase,
      };
    case 'json':
      return {
        content: exportDiffAsJson(summary, rows, meta),
        mime: 'application/json;charset=utf-8',
        extension: 'json',
        filenameBase,
      };
    case 'markdown':
      return {
        content: exportDiffAsMarkdown(summary, rows, meta),
        mime: 'text/markdown;charset=utf-8',
        extension: 'md',
        filenameBase,
      };
    case 'html':
      return {
        content: exportDiffAsHtml(summary, rows, meta),
        mime: 'text/html;charset=utf-8',
        extension: 'html',
        filenameBase,
      };
    case 'side_by_side':
      return {
        content: exportDiffAsSideBySideHtml(summary, rows, meta),
        mime: 'text/html;charset=utf-8',
        extension: 'html',
        filenameBase: `${filenameBase}-side-by-side`,
      };
    default:
      return {
        content: exportDiffAsJson(summary, rows, meta),
        mime: 'application/json;charset=utf-8',
        extension: 'json',
        filenameBase,
      };
  }
};

export const downloadTextFile = (filename: string, content: string, mime: string): void => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
};
