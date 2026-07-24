import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  V2_WORKBENCH_TAB_MAX_WIDTH,
  V2_WORKBENCH_TAB_MIN_WIDTH,
  resolveV2WorkbenchTabWidth,
} from './TabManager';

const themeSource = readFileSync(new URL('../v2-theme.css', import.meta.url), 'utf8');
const tabManagerSource = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

describe('v2 workbench adaptive tab width', () => {
  it('keeps the preferred width when the strip has enough room', () => {
    expect(resolveV2WorkbenchTabWidth(1600, 5)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
    expect(resolveV2WorkbenchTabWidth(800, 2)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
  });

  it('shares the available width equally before using overflow', () => {
    expect(resolveV2WorkbenchTabWidth(1000, 5)).toBe(199);
    expect(resolveV2WorkbenchTabWidth(1200, 10)).toBe(119);
  });

  it('stops shrinking at the readable minimum', () => {
    expect(resolveV2WorkbenchTabWidth(1000, 10)).toBe(V2_WORKBENCH_TAB_MIN_WIDTH);
    expect(resolveV2WorkbenchTabWidth(320, 8)).toBe(V2_WORKBENCH_TAB_MIN_WIDTH);
  });

  it('uses the preferred width until a measurable strip and tab count exist', () => {
    expect(resolveV2WorkbenchTabWidth(0, 4)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
    expect(resolveV2WorkbenchTabWidth(Number.NaN, 4)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
    expect(resolveV2WorkbenchTabWidth(1000, 0)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
    expect(resolveV2WorkbenchTabWidth(1000, -2)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
    expect(resolveV2WorkbenchTabWidth(1000, Number.NaN)).toBe(V2_WORKBENCH_TAB_MAX_WIDTH);
  });

  it('observes the stable workbench width instead of the overflow-sensitive nav wrap', () => {
    expect(tabManagerSource).toContain('ref={tabWorkbenchRef}');
    expect(tabManagerSource).toContain('new ResizeObserver((entries) => {');
    expect(tabManagerSource).toContain('return () => observer.disconnect();');
    expect(tabManagerSource).toContain('resolveV2WorkbenchTabWidth(availableWidth, dockedTabs.length)');
    expect(tabManagerSource).not.toContain("querySelector('.ant-tabs-nav-wrap')");
  });

  it('applies the measured width to every v2 tab', () => {
    expect(themeSource).toMatch(
      /\.gn-v2-main-tabs \.ant-tabs-tab \{[^}]*width: var\(--gn-v2-tab-width, 260px\);[^}]*min-width: var\(--gn-v2-tab-width, 260px\);[^}]*max-width: var\(--gn-v2-tab-width, 260px\);/s,
    );
    expect(themeSource).not.toMatch(
      /\.gn-v2-main-tabs \.ant-tabs-tab \{[^}]*width: 260px;[^}]*min-width: 260px;[^}]*max-width: 260px;/s,
    );
  });
});
