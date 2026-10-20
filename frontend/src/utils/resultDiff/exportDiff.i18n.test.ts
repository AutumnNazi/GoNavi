import { afterEach, describe, expect, it } from 'vitest';
import { catalogs } from '../../i18n/catalog';
import { getCurrentLanguage, setCurrentLanguage, t, type SupportedLanguage } from '../../i18n';
import { exportDiffAsSideBySideHtml } from './exportDiff';
import { escapeResultDiffHtml } from './resultDiffHtmlTemplate';
import type { ResultDiffRow, ResultDiffSummary } from './types';

const initialLanguage = getCurrentLanguage();
const localeTitles: Record<SupportedLanguage, string> = {
  'zh-CN': '并排对比 · Result Diff',
  'zh-TW': '並排比較 · Result Diff',
  'en-US': 'Side-by-side · Result Diff',
  'ja-JP': '左右比較 · Result Diff',
  'de-DE': 'Vergleich nebeneinander · Result Diff',
  'ru-RU': 'Сравнение бок о бок · Result Diff',
};
const summary: ResultDiffSummary = {
  added: 2, removed: 3, changed: 4, same: 5, unmatched: 6,
  leftRowCount: 12, rightRowCount: 11,
  commonColumns: ['id'], leftOnlyColumns: [], rightOnlyColumns: [],
  changedColumnFreq: { id: 4 }, keyColumns: ['id'], comparedColumns: ['id'],
};
const rows: ResultDiffRow[] = [{
  kind: 'changed', keys: { id: 1 }, left: { id: 1 }, right: { id: 2 },
}];
const meta = { leftLabel: 'Before', rightLabel: 'After', exportedAt: '2026-10-15T00:00:00Z' };

afterEach(() => setCurrentLanguage(initialLanguage));

describe('side-by-side HTML localization', () => {
  it.each(Object.entries(localeTitles) as [SupportedLanguage, string][])(
    'uses the current %s catalog for document copy', (language, title) => {
      setCurrentLanguage(language);
      const html = exportDiffAsSideBySideHtml(summary, rows, meta);
      expect(html).toContain(`<html lang="${language}">`);
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toContain(`<h1>${title}</h1>`);
      for (const [kind, count] of [['added', 2], ['removed', 3], ['changed', 4], ['same', 5], ['unmatched', 6]]) {
        expect(html).toContain(`${count} ${escapeResultDiffHtml(t(`result_diff.panel.${kind}`))}</span>`);
      }
      for (const kind of ['same', 'removed', 'added', 'changed']) {
        expect(html).toContain(`class="l-${kind}"></i>${escapeResultDiffHtml(t(`result_diff.preview.legend.${kind}`))}`);
      }
      expect(html).toContain(`<div class="gutter">${escapeResultDiffHtml(t('result_diff.preview.gutter'))}</div>`);
      expect(html).not.toMatch(/\{\{|result_diff\./);
    },
  );

  it('reads the language again for later exports, rather than at import time', () => {
    setCurrentLanguage('en-US');
    const english = exportDiffAsSideBySideHtml(summary, rows, meta);
    setCurrentLanguage('de-DE');
    const german = exportDiffAsSideBySideHtml(summary, rows, meta);
    expect(english).toContain(localeTitles['en-US']);
    expect(german).toContain(localeTitles['de-DE']);
    expect(german).not.toContain(localeTitles['en-US']);
  });

  it('escapes translated copy and interpolated labels, headers, cells and heat values', () => {
    setCurrentLanguage('en-US');
    const payload = '<img src=x onerror="alert(1)"> & \'quoted\'';
    const escaped = escapeResultDiffHtml(payload);
    const catalog = catalogs['en-US'];
    const keys = [
      'result_diff.export.side_by_side_title', 'result_diff.panel.added',
      'result_diff.preview.legend.same', 'result_diff.preview.gutter',
    ] as const;
    const originals = keys.map((key) => catalog[key]);
    try {
      keys.forEach((key) => { catalog[key] = payload; });
      const hostileSummary = {
        ...summary, commonColumns: [payload], keyColumns: [payload], comparedColumns: [payload],
        changedColumnFreq: { [payload]: 4 },
      };
      const hostileRows: ResultDiffRow[] = [{
        kind: 'changed', keys: {}, left: { [payload]: payload }, right: { [payload]: 'safe' },
      }];
      const html = exportDiffAsSideBySideHtml(hostileSummary, hostileRows, {
        leftLabel: payload, rightLabel: payload, exportedAt: payload, filterNote: payload,
        columnMeta: { [payload]: { type: payload } },
      });
      expect(html).toContain(`<title>${escaped}</title>`);
      expect(html).toContain(`<h1>${escaped}</h1>`);
      expect(html).toContain(`class="pane-title">${escaped}</span>`);
      expect(html).toContain(`class="col-type">${escaped}</div>`);
      expect(html).toContain(`title="${escaped}">${escaped}</td>`);
      expect(html).toContain(`<code>${escaped}</code>×4`);
      expect(html).toContain(`class="l-same"></i>${escaped}</span>`);
      expect(html).toContain(`<div class="gutter">${escaped}</div>`);
      expect(html).not.toContain('<img');
      expect(html).not.toContain(payload);
      expect(html).toContain("left.addEventListener('scroll'");
      expect(html).toContain("right.addEventListener('scroll'");
      expect(html).toContain('cell-changed');
    } finally {
      keys.forEach((key, index) => { catalog[key] = originals[index]; });
    }
  });

  it('localizes empty side labels without allowing translation markup', () => {
    setCurrentLanguage('ja-JP');
    const html = exportDiffAsSideBySideHtml(summary, [], { leftLabel: '', rightLabel: '' });
    expect(html).toContain(`class="pane-title">${escapeResultDiffHtml(t('result_diff.wizard.left'))}</span>`);
    expect(html).toContain(`class="pane-title">${escapeResultDiffHtml(t('result_diff.wizard.right'))}</span>`);
  });
});
