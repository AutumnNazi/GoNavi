import { getCurrentLanguage, t } from '../../i18n';
import type { ResultDiffExportMeta } from './exportDiff';
import type { ResultDiffSummary } from './types';

export const escapeResultDiffHtml = (value: string | number): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SIDE_BY_SIDE_CSS = `
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --border: #2a3544;
      --text: #e8eef7;
      --muted: #8b9bb4;
      --same: transparent;
      --removed-bg: rgba(255, 77, 79, 0.22);
      --removed-fg: #ff9c9e;
      --added-bg: rgba(82, 196, 26, 0.20);
      --added-fg: #95de64;
      --changed-bg: rgba(250, 173, 20, 0.22);
      --changed-fg: #ffd666;
      --header-bg: #121a24;
      --gutter: #243044;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    .toolbar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px;
      padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--panel);
      position: sticky; top: 0; z-index: 5;
    }
    .toolbar h1 { font-size: 15px; font-weight: 600; margin: 0; }
    .meta { color: var(--muted); font-size: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      font-size: 12px; padding: 2px 10px; border-radius: 999px;
      background: #243044; color: var(--text);
    }
    .chip.added { background: var(--added-bg); color: var(--added-fg); }
    .chip.removed { background: var(--removed-bg); color: var(--removed-fg); }
    .chip.changed { background: var(--changed-bg); color: var(--changed-fg); }
    .legend {
      display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted);
      padding: 8px 16px; border-bottom: 1px solid var(--border);
    }
    .legend i {
      display: inline-block; width: 12px; height: 12px; border-radius: 2px;
      margin-right: 6px; vertical-align: -2px; border: 1px solid var(--border);
    }
    .legend .l-same { background: transparent; }
    .legend .l-removed { background: var(--removed-bg); }
    .legend .l-added { background: var(--added-bg); }
    .legend .l-changed { background: var(--changed-bg); }
    .heat { padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--border); }
    .heat-chip {
      font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #243044; color: var(--muted);
    }
    .heat-chip code { color: var(--changed-fg); }
    .split {
      display: grid;
      grid-template-columns: 1fr 10px 1fr;
      height: calc(100vh - 140px);
      min-height: 360px;
    }
    .gutter {
      background: var(--gutter);
      display: flex; align-items: center; justify-content: center;
      color: var(--muted); font-size: 11px; writing-mode: vertical-rl;
      letter-spacing: 2px; user-select: none;
    }
    .pane { display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
    .pane-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .pane-title { font-weight: 600; }
    .pane-count { color: var(--muted); font-size: 12px; }
    .table-scroll { overflow: auto; flex: 1; }
    table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 12px; }
    th, td {
      border: 1px solid var(--border); padding: 4px 8px; white-space: nowrap;
      max-width: 220px; overflow: hidden; text-overflow: ellipsis;
    }
    th {
      position: sticky; top: 0; z-index: 2;
      background: var(--header-bg); color: var(--muted); font-weight: 600;
    }
    th .col-name { color: var(--text); font-weight: 600; font-size: 12px; line-height: 1.2; }
    th .col-type { color: var(--muted); font-weight: 400; font-size: 11px; line-height: 1.2; margin-top: 2px; }
    th.row-no, td.row-no {
      position: sticky; left: 0; z-index: 1;
      background: var(--header-bg); color: var(--muted); text-align: right; min-width: 40px;
    }
    td.row-no { background: #121a24; z-index: 0; }
    tr:hover td { filter: brightness(1.08); }
    .cell-same { color: var(--text); }
    .cell-empty { background: #0a0e13; color: #3a4658; }
    .cell-removed { background: var(--removed-bg); color: var(--removed-fg); }
    .cell-added { background: var(--added-bg); color: var(--added-fg); }
    .cell-changed { background: var(--changed-bg); color: var(--changed-fg); font-weight: 600; }
    .kind-cell { font-size: 11px; text-transform: uppercase; }
    .kind-added { color: var(--added-fg); }
    .kind-removed { color: var(--removed-fg); }
    .kind-changed { color: var(--changed-fg); }
    .kind-same { color: var(--muted); }
    .kind-unmatched { color: #69c0ff; }
    tr.row-added td.row-no { box-shadow: inset 3px 0 0 var(--added-fg); }
    tr.row-removed td.row-no { box-shadow: inset 3px 0 0 var(--removed-fg); }
    tr.row-changed td.row-no { box-shadow: inset 3px 0 0 var(--changed-fg); }
    @media (max-width: 900px) {
      .split { grid-template-columns: 1fr; height: auto; }
      .gutter { writing-mode: horizontal-tb; padding: 6px; }
    }
    @media print {
      body { background: #fff; color: #111; }
      .toolbar, .legend, .heat { position: static; }
      .split { height: auto; display: block; }
      .pane { page-break-inside: avoid; margin-bottom: 16px; }
      th, td { border-color: #ccc; }
      .cell-removed { background: #ffe8e8; color: #a00; }
      .cell-added { background: #e8ffe8; color: #060; }
      .cell-changed { background: #fff6d6; color: #860; }
    }
`;

interface SideBySideDocumentInput {
  summary: ResultDiffSummary;
  meta: ResultDiffExportMeta;
  leftTableHtml: string;
  rightTableHtml: string;
  heatHtml: string;
}

export const buildSideBySideDocument = ({
  summary, meta, leftTableHtml, rightTableHtml, heatHtml,
}: SideBySideDocumentInput): string => {
  const title = escapeResultDiffHtml(t('result_diff.export.side_by_side_title'));
  const leftTitle = escapeResultDiffHtml(meta.leftLabel || t('result_diff.wizard.left'));
  const rightTitle = escapeResultDiffHtml(meta.rightLabel || t('result_diff.wizard.right'));
  const exportedAt = escapeResultDiffHtml(meta.exportedAt || new Date().toISOString());
  const filterNote = meta.filterNote ? escapeResultDiffHtml(meta.filterNote) : '';
  return `<!DOCTYPE html>
<html lang="${escapeResultDiffHtml(getCurrentLanguage())}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${SIDE_BY_SIDE_CSS}</style>
</head>
<body>
  <div class="toolbar">
    <h1>${title}</h1>
    <div class="meta">
      ${leftTitle} → ${rightTitle}
      · ${exportedAt}
      ${filterNote ? ` · ${filterNote}` : ''}
    </div>
    <div class="chips">
      <span class="chip added">+${escapeResultDiffHtml(summary.added)} ${escapeResultDiffHtml(t('result_diff.panel.added'))}</span>
      <span class="chip removed">-${escapeResultDiffHtml(summary.removed)} ${escapeResultDiffHtml(t('result_diff.panel.removed'))}</span>
      <span class="chip changed">~${escapeResultDiffHtml(summary.changed)} ${escapeResultDiffHtml(t('result_diff.panel.changed'))}</span>
      <span class="chip">=${escapeResultDiffHtml(summary.same)} ${escapeResultDiffHtml(t('result_diff.panel.same'))}</span>
      <span class="chip">?${escapeResultDiffHtml(summary.unmatched)} ${escapeResultDiffHtml(t('result_diff.panel.unmatched'))}</span>
    </div>
  </div>
  <div class="legend">
    <span><i class="l-same"></i>${escapeResultDiffHtml(t('result_diff.preview.legend.same'))}</span>
    <span><i class="l-removed"></i>${escapeResultDiffHtml(t('result_diff.preview.legend.removed'))}</span>
    <span><i class="l-added"></i>${escapeResultDiffHtml(t('result_diff.preview.legend.added'))}</span>
    <span><i class="l-changed"></i>${escapeResultDiffHtml(t('result_diff.preview.legend.changed'))}</span>
  </div>
  ${heatHtml ? `<div class="heat">${heatHtml}</div>` : ''}
  <div class="split">
    ${leftTableHtml}
    <div class="gutter">${escapeResultDiffHtml(t('result_diff.preview.gutter'))}</div>
    ${rightTableHtml}
  </div>
  <script>
    (function () {
      var left = document.querySelector('.table-scroll[data-side="left"]');
      var right = document.querySelector('.table-scroll[data-side="right"]');
      if (!left || !right) return;
      var lock = false;
      function sync(from, to) {
        if (lock) return;
        lock = true;
        to.scrollTop = from.scrollTop;
        to.scrollLeft = from.scrollLeft;
        lock = false;
      }
      left.addEventListener('scroll', function () { sync(left, right); });
      right.addEventListener('scroll', function () { sync(right, left); });
    })();
  </script>
</body>
</html>
`;
};
