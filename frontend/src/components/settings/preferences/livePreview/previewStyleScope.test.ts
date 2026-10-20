// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scopePreviewSelector, collectPreviewStyles } from './previewStyleScope';
import { PREVIEW_RECORDS, runPreviewQuery } from './previewData';

describe('preview isolation', () => {
  it('preserves theme and layout selectors while scoping body and root to the preview', () => {
    expect(scopePreviewSelector("body[data-theme='dark'] .grid, html body .editor, :root"))
      .toBe("[data-preview-body][data-theme='dark'] .grid, [data-preview-root] [data-preview-body] .editor, [data-preview-root]");
    expect(scopePreviewSelector('.body-copy [data-body-name]')).toBe('.body-copy [data-body-name]');
  });
  it('copies current theme rules, including media queries, without modifying the source', () => {
    const style = document.createElement('style');
    style.textContent = 'body[data-theme="dark"] { --gn-accent: #aabbcc; } @media (min-width: 600px) { body .grid { color: red; } }';
    document.head.append(style);
    const css = collectPreviewStyles(document);
    expect(css).toContain('[data-preview-body][data-theme="dark"]');
    expect(css).toContain('@media');
    expect(css).toContain('[data-preview-body] .grid');
    expect(style.textContent).toContain('body[data-theme="dark"]');
    style.remove();
  });
  it('runs only against fixture data and does not mutate the fixtures', () => {
    expect(runPreviewQuery('SELECT * FROM customers LIMIT 1;')?.rows).toHaveLength(1);
    expect(runPreviewQuery('DELETE FROM orders')).toBeNull();
    expect(runPreviewQuery('SELECT * FROM production')).toBeNull();
    expect(runPreviewQuery('SELECT * FROM orders; DELETE FROM orders;')).toBeNull();
    expect(PREVIEW_RECORDS.customers).toHaveLength(2);
  });
});
