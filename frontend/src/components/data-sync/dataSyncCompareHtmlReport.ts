import { describeCompareRow } from './dataSyncCompareRowModel';
import {
  buildCompareSummary,
  sharePercent,
  tableRiskLevel,
} from './dataSyncCompareSummaryModel';
import type {
  CompareBarItem,
  CompareKpi,
  CompareSummary,
} from './dataSyncCompareSummaryModel';
import type {
  DataSyncColumnStructureDiff,
  DataSyncCompareMode,
  DataSyncCompareResult,
  DataSyncIndexStructureDiff,
  DataSyncTableDiffSummary,
} from './model';
import type { DataSyncWorkbenchTranslate } from './text';

export type CompareReportMeta = {
  taskName: string;
  sourceLabel: string;
  targetLabel: string;
  generatedAt: string;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// 报告是独立文件，不能引用应用内的 --gn-* 变量；这里固化一套浅色取值，
// 与工作台浅色主题同源，保证导出后在任何浏览器里观感一致。
const REPORT_STYLE = `
:root{color-scheme:light;}
*{box-sizing:border-box;}
body{margin:0;padding:40px 32px 64px;background:#f6f6f4;color:#0c1322;
  font-family:"Inter","PingFang SC","Noto Sans CJK SC","Microsoft YaHei",-apple-system,sans-serif;
  font-size:14px;line-height:1.5;}
.gn-report{max-width:1080px;margin:0 auto;}
h1{margin:0 0 4px;font-size:20px;font-weight:600;}
.gn-report-meta{margin:0 0 24px;color:#6b7280;font-size:12px;}
.gn-report-meta code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;}
.gn-hero{padding:20px 22px;border:0.5px solid rgba(15,23,42,.08);border-radius:12px;
  background:#fff;box-shadow:0 0 0 .5px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.06);}
.gn-hero-value{display:flex;align-items:baseline;gap:10px;}
.gn-hero-value strong{font-size:48px;font-weight:600;line-height:1.05;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;}
.gn-hero-value span{color:#6b7280;font-size:13px;}
.gn-hero p{margin:10px 0 0;color:#6b7280;font-size:12px;}
.gn-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0 0;}
.gn-kpi{min-width:0;padding:12px 14px;border:0.5px solid rgba(15,23,42,.08);
  border-radius:10px;background:#fff;}
.gn-kpi dt{color:#9ca3af;font-size:11px;}
.gn-kpi dd{margin:6px 0 0;display:flex;flex-direction:column;gap:2px;}
.gn-kpi strong{font-size:26px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;}
.gn-kpi small{color:#6b7280;font-size:11px;}
.gn-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px;margin:18px 0 0;}
.gn-grid > .gn-full{grid-column:1/-1;}
h2{margin:0 0 10px;color:#4b5563;font-size:12px;font-weight:600;}
.gn-bars{list-style:none;margin:0;padding:0;display:grid;gap:8px;}
.gn-bars li{display:grid;grid-template-columns:minmax(64px,92px) minmax(0,1fr) auto;
  align-items:center;gap:10px;}
.gn-bars .label{color:#6b7280;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gn-bars .track{height:9px;border-radius:999px;background:rgba(15,23,42,.045);overflow:hidden;}
.gn-bars .fill{display:block;height:100%;min-width:2px;border-radius:0 999px 999px 0;background:#9ca3af;}
.gn-bars .value{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;}
[data-tone="danger"] .fill,[data-tone="danger"].dot{background:rgba(220,38,38,.58);}
[data-tone="warn"] .fill,[data-tone="warn"].dot{background:rgba(217,119,6,.58);}
[data-tone="ok"] .fill,[data-tone="ok"].dot{background:rgba(21,128,61,.58);}
.gn-band{display:flex;height:26px;border-radius:6px;background:rgba(15,23,42,.045);overflow:hidden;}
.gn-band span{min-width:2px;height:100%;}
.gn-band [data-tone="danger"]{background:#e79c9c;}
.gn-band [data-tone="warn"]{background:#f0c48a;}
.gn-band [data-tone="ok"]{background:#93c9a8;}
.gn-legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin:10px 0 0;padding:0;list-style:none;}
.gn-legend li{display:inline-flex;align-items:center;gap:6px;color:#6b7280;font-size:11px;}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;}
.gn-legend strong{color:#1f2937;font-variant-numeric:tabular-nums;}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;
  border:0.5px solid rgba(15,23,42,.08);}
th,td{padding:9px 12px;text-align:left;border-bottom:0.5px solid rgba(15,23,42,.08);
  font-size:12px;vertical-align:top;}
th{color:#6b7280;font-weight:600;background:#fafaf8;}
tr:last-child td{border-bottom:0;}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
td code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:11px;}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;}
.tag[data-status="diff"]{color:#b45309;background:rgba(217,119,6,.14);}
.tag[data-status="same"]{color:#15803d;background:rgba(22,163,74,.12);}
.tag[data-status="unknown"]{color:#6b7280;background:rgba(15,23,42,.08);}
.diffs{margin:0;padding:0;list-style:none;display:grid;gap:3px;}
.diffs li{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.diffs .kind{color:#9ca3af;font-size:11px;}
.diffs code{padding:1px 6px;border-radius:4px;background:rgba(15,23,42,.04);}
.muted{color:#6b7280;font-size:12px;}
@media (max-width:820px){
  body{padding:24px 16px 48px;}
  .gn-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}
  .gn-grid{grid-template-columns:minmax(0,1fr);}
}
@media print{
  body{background:#fff;padding:0;}
  .gn-hero,.gn-kpi,table{box-shadow:none;}
}
`;

const renderKpi = (kpi: CompareKpi, total: number, t: DataSyncWorkbenchTranslate): string => {
  const hint = kpi.hint.kind === 'share'
    ? t('compare.summary.share_of_total', { percent: sharePercent(kpi.value, total) })
    : t(
      kpi.hint.count === 1
        ? 'compare.summary.tables_affected_one'
        : 'compare.summary.tables_affected',
      { count: kpi.hint.count },
    );
  return `<div class="gn-kpi"><dt>${escapeHtml(t(kpi.labelKey))}</dt>`
    + `<dd><strong>${escapeHtml(kpi.value.toLocaleString())}</strong>`
    + `<small>${escapeHtml(hint)}</small></dd></div>`;
};

const renderBars = (
  bars: CompareBarItem[],
  emptyText: string,
  t: DataSyncWorkbenchTranslate,
): string => {
  const max = bars.reduce((peak, bar) => Math.max(peak, bar.value), 0);
  if (max === 0) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  const rows = bars.map((bar) => {
    const width = Math.round((bar.value / max) * 1000) / 10;
    return `<li data-tone="${bar.tone}">`
      + `<span class="label">${escapeHtml(t(bar.labelKey))}</span>`
      + `<span class="track"><span class="fill" style="width:${width}%"></span></span>`
      + `<span class="value">${escapeHtml(bar.value.toLocaleString())}</span></li>`;
  });
  return `<ul class="gn-bars">${rows.join('')}</ul>`;
};

const renderRiskBand = (summary: CompareSummary, t: DataSyncWorkbenchTranslate): string => {
  const buckets = [
    { key: 'blocking' as const, tone: 'danger', labelKey: 'compare.risk.blocking' as const },
    { key: 'attention' as const, tone: 'warn', labelKey: 'compare.risk.attention' as const },
    { key: 'compatible' as const, tone: 'ok', labelKey: 'compare.risk.compatible' as const },
  ];
  const total = buckets.reduce((sum, bucket) => sum + summary.risk[bucket.key], 0);
  const segments = total === 0
    ? ''
    : buckets
      .filter((bucket) => summary.risk[bucket.key] > 0)
      .map((bucket) => `<span data-tone="${bucket.tone}" style="width:${
        Math.round((summary.risk[bucket.key] / total) * 1000) / 10}%"></span>`)
      .join('');
  const legend = buckets.map((bucket) => `<li data-tone="${bucket.tone}">`
    + `<span class="dot"></span><span>${escapeHtml(t(bucket.labelKey))}</span>`
    + `<strong>${escapeHtml(summary.risk[bucket.key].toLocaleString())}</strong></li>`).join('');
  return `<div class="gn-full"><h2>${escapeHtml(t('compare.risk.title'))}</h2>`
    + `<p class="muted">${escapeHtml(t('compare.risk.total', { count: total.toLocaleString() }))}</p>`
    + `<div class="gn-band" role="img">${segments}</div>`
    + `<ul class="gn-legend">${legend}</ul></div>`;
};

const renderDiffList = (
  diffs: DataSyncColumnStructureDiff[],
  t: DataSyncWorkbenchTranslate,
): string => {
  if (diffs.length === 0) return '<span class="muted">—</span>';
  const items = diffs.map((diff) => {
    const before = diff.source ? `<code>${escapeHtml(diff.source)}</code>` : '';
    const after = diff.target ? `<code>${escapeHtml(diff.target)}</code>` : '';
    const arrow = diff.kind === 'type' || diff.kind === 'nullable'
      ? `${before || '<code>—</code>'} → ${after || '<code>—</code>'}`
      : `${before}${after}`;
    return `<li><span class="kind">${escapeHtml(t(`compare.diff_kind.${diff.kind}`))}</span>`
      + `<code>${escapeHtml(diff.column)}</code>${arrow}</li>`;
  });
  return `<ul class="diffs">${items.join('')}</ul>`;
};

const RISK_CLASS: Record<string, string> = {
  blocking: 't-high',
  attention: 't-mid',
  compatible: 't-low',
};

const renderRiskTag = (
  summary: DataSyncTableDiffSummary,
  t: DataSyncWorkbenchTranslate,
): string => {
  const level = tableRiskLevel(summary);
  if (!level) return '<span class="muted">—</span>';
  const label = level === 'blocking'
    ? t('compare.risk.filter_high')
    : level === 'attention'
      ? t('compare.risk.filter_mid')
      : t('compare.risk.filter_low');
  return `<span class="tag ${RISK_CLASS[level]}"><span class="dot"></span>${escapeHtml(label)}</span>`;
};

const renderIndexList = (
  diffs: DataSyncIndexStructureDiff[],
  t: DataSyncWorkbenchTranslate,
): string => {
  if (diffs.length === 0) return '';
  const items = diffs.map((diff) => {
    const detail = diff.kind === 'changed'
      ? `<code>${escapeHtml(diff.source || '—')}</code> → <code>${escapeHtml(diff.target || '—')}</code>`
      : `<code>${escapeHtml(diff.source || diff.target || '—')}</code>`;
    return `<li><span class="kind idx">${escapeHtml(t(`compare.index_kind.${diff.kind}`))}</span>`
      + `<code>${escapeHtml(diff.name)}</code>${detail}</li>`;
  });
  return `<ul class="diffs diffs-idx" data-index-diffs="true">${items.join('')}</ul>`;
};

const renderTableRows = (
  tables: DataSyncTableDiffSummary[],
  mode: DataSyncCompareMode | undefined,
  showData: boolean,
  showSchema: boolean,
  t: DataSyncWorkbenchTranslate,
): string => tables.map((summary) => {
  const row = describeCompareRow(summary, mode);
  const statusLabel = row.status === 'unknown'
    ? t('compare.status_blocked')
    : row.status === 'diff'
      ? t('compare.status_diff')
      : t('compare.status_same');
  const dataCells = showData
    ? `<td class="num">${summary.inserts.toLocaleString()}</td>`
      + `<td class="num">${summary.updates.toLocaleString()}</td>`
      + `<td class="num">${summary.deletes.toLocaleString()}</td>`
    : '';
  const diffCell = showSchema
    ? `<td>${row.status === 'same'
      ? (summary.schemaDiffCount ? `<span class="num">${summary.schemaDiffCount.toLocaleString()}</span>` : '<span class="muted">—</span>')
      : `${renderDiffList(row.columnDiffs, t)}${renderIndexList(summary.indexDiffs || [], t)}`}</td>`
    : '';
  const notes = [row.message, ...row.warnings].filter(Boolean)
    .map((note) => escapeHtml(note)).join('<br>');
  return `<tr data-status="${row.status}">`
    + `<td><span class="tag" data-status="${row.status}">${escapeHtml(statusLabel)}</span></td>`
    + `<td><code>${escapeHtml(summary.table)}</code>`
    + `${summary.sourceObject || summary.targetObject
      ? `<div class="muted">${escapeHtml(summary.sourceObject || '—')} → ${escapeHtml(summary.targetObject || '—')}</div>` : ''}</td>`
    + dataCells + diffCell
    + `<td>${renderRiskTag(summary, t)}</td>`
    + `<td>${notes || '<span class="muted">—</span>'}</td></tr>`;
}).join('');

/**
 * 渲染自包含的对比结果 HTML 报告。纯字符串拼接、无 DOM 依赖，便于单测；
 * 所有来自库表元数据的文本都经过转义，报告可直接在浏览器打开。
 */
export const buildCompareHtmlReport = (
  result: DataSyncCompareResult,
  options: { compareMode?: DataSyncCompareMode; meta: CompareReportMeta; t: DataSyncWorkbenchTranslate },
): string => {
  const { meta, t } = options;
  const summary = buildCompareSummary(result, options.compareMode);
  const mode = result.content || options.compareMode;
  const kpis = summary.kpis.map((kpi) => renderKpi(kpi, summary.total, t)).join('');
  const dataHeaders = summary.showData
    ? `<th>${escapeHtml(t('compare.inserts'))}</th>`
      + `<th>${escapeHtml(t('compare.updates'))}</th>`
      + `<th>${escapeHtml(t('compare.deletes'))}</th>`
    : '';
  const schemaHeader = summary.showSchema ? `<th>${escapeHtml(t('compare.schema_diff'))}</th>` : '';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t('compare.title'))} · ${escapeHtml(meta.taskName)}</title>
<style>${REPORT_STYLE}</style></head>
<body><div class="gn-report">
<h1>${escapeHtml(t('compare.title'))}</h1>
<p class="gn-report-meta">${escapeHtml(meta.taskName)}
 · <code>${escapeHtml(meta.sourceLabel)}</code> → <code>${escapeHtml(meta.targetLabel)}</code>
 · ${escapeHtml(meta.generatedAt)}</p>
<div class="gn-hero"><div class="gn-hero-value"><strong>${escapeHtml(summary.total.toLocaleString())}</strong>
<span>${escapeHtml(t('compare.summary.tables_total'))}</span></div>
<p>${escapeHtml(t('compare.summary.hero_caption', {
    diff: summary.diff, same: summary.same, unknown: summary.unknown,
  }))}</p></div>
<div class="gn-kpis">${kpis}</div>
<div class="gn-grid">
<div><h2>${escapeHtml(t('compare.summary.status_distribution'))}</h2>
${renderBars(summary.statusBars, t('compare.summary.no_diff_kinds'), t)}</div>
${summary.showSchema ? `<div><h2>${escapeHtml(t('compare.summary.diff_kind_distribution'))}</h2>
${renderBars(summary.diffKindBars, t('compare.summary.no_diff_kinds'), t)}</div>` : ''}
${summary.showSchema ? renderRiskBand(summary, t) : ''}
</div>
<h2 style="margin-top:24px">${escapeHtml(t('compare.report.detail'))}</h2>
<table><thead><tr><th>${escapeHtml(t('compare.report.status'))}</th><th>${escapeHtml(t('compare.table'))}</th>
${dataHeaders}${schemaHeader}<th>${escapeHtml(t('compare.report.notes'))}</th></tr></thead>
<tbody>${renderTableRows(result.tables, mode, summary.showData, summary.showSchema, t)}</tbody></table>
</div></body></html>`;
};

/** 报告的默认文件名，不含扩展名；由导出绑定补 .html。 */
export const buildCompareReportFileName = (
  taskName: string,
  generatedAt: string,
): string => {
  const safeTask = (taskName.trim() || 'compare').replace(/[\\/:*?"<>|]/g, '_');
  const stamp = generatedAt.replace(/[:T]/g, '-').replace(/\..*$/, '');
  return `${safeTask}-compare-${stamp}`;
};
