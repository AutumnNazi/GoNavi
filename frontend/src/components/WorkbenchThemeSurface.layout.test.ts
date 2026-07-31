import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readWorkbenchCss = (): string => readFileSync(
  new URL('../styles/v2-theme-workbench.css', import.meta.url),
  'utf8',
);

const readV2ThemeCss = (): string => readFileSync(
  new URL('../v2-theme.css', import.meta.url),
  'utf8',
);

const readSection = (css: string, startMarker: string, endMarker: string): string => {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
};

describe('V2 workbench theme surfaces', () => {
  it('keeps Redis and Nacos workbench backgrounds on the secondary theme panel', () => {
    const css = readWorkbenchCss();
    const v2ThemeCss = readV2ThemeCss();
    const redisRootCss = readSection(
      v2ThemeCss,
      'body[data-ui-version="v2"] .redis-viewer-workbench',
      'body[data-ui-version="v2"] .redis-tree-expander-button:hover',
    );
    const redisCss = readSection(
      css,
      '/* ─── V2 Redis workbench ─ */',
      '/* ─── V2 Nacos workbench',
    );
    const nacosCss = readSection(
      css,
      '/* ─── V2 Nacos workbench',
      '/* ─── Nacos service discovery:',
    );

    expect(redisCss).toContain('background: var(--gn-bg-panel-2)');
    expect(redisCss).not.toMatch(/background:\s*var\(--gn-bg-panel\)(?:\s*!important)?;/);
    expect(redisRootCss).toContain('background: var(--gn-bg-panel-2) !important;');
    expect(redisRootCss).not.toContain('background: var(--gn-bg-app) !important;');
    expect(nacosCss).toContain('background: var(--gn-bg-panel-2)');
    expect(nacosCss).not.toMatch(/background:\s*var\(--gn-bg-panel\)(?:\s*!important)?;/);
  });

  it('keeps sidebar and Nacos filter inputs on their surrounding theme surface', () => {
    const css = readWorkbenchCss();
    const v2ThemeCss = readV2ThemeCss();
    const explorerSearchCss = readSection(
      v2ThemeCss,
      'body[data-ui-version="v2"] .gn-v2-explorer-search',
      'body[data-ui-version="v2"] .gn-v2-explorer-filter-tabs',
    );
    const nacosFilterCss = readSection(
      css,
      '/* Filter row: grow with left pane width so long DataId/Group names fit better */',
      '.gn-nacos-selection-toolbar',
    );

    expect(explorerSearchCss).toContain('background: var(--gn-bg-panel-2)');
    expect(explorerSearchCss).not.toContain('background: var(--gn-bg-input)');
    expect(nacosFilterCss).toContain('background: var(--gn-bg-panel-2) !important;');
  });
});
