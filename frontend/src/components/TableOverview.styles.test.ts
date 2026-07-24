import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/v2-theme-workbench.css', import.meta.url), 'utf8');

describe('TableOverview compact table styles', () => {
  it('keeps the toolbar compact when the overview content is narrow', () => {
    expect(css).toContain('container-name: gn-table-overview;');
    expect(css).toMatch(
      /@container gn-table-overview \(max-width: 700px\)\s*\{[^}]*\.gn-table-overview-header\s*\{[^}]*gap:\s*8px !important;/s,
    );
    expect(css).toMatch(
      /@container gn-table-overview \(max-width: 700px\)[\s\S]*\.gn-table-overview-summary\s*\{[^}]*display:\s*none;/,
    );
  });

  it('keeps the legacy compact table readable in dark mode', () => {
    expect(css).toMatch(
      /body\[data-ui-version="legacy"\]\[data-theme="dark"\] \.gn-table-overview-compact-scroll\s*\{[^}]*background:\s*#141414;/s,
    );
    expect(css).toMatch(
      /body\[data-ui-version="legacy"\]\[data-theme="dark"\] \.gn-table-overview-compact-header\s*\{[^}]*background:\s*#1f1f1f;[^}]*color:\s*rgba\(255, 255, 255, 0\.65\);/s,
    );
    expect(css).toMatch(
      /body\[data-ui-version="legacy"\]\[data-theme="dark"\] \.gn-table-overview-compact-section\s*\{[^}]*background:\s*#1f1f1f;/s,
    );
  });
});
