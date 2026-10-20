import { describe, expect, it } from 'vitest';
import { getDensityParams } from './dataGridDisplay';
import { buildDataGridDensityCss, resolveDataGridDensityVariables, resolveDataGridRowHeight } from './dataGridDensity';

describe('shared data grid density geometry', () => {
  it.each([
    ['comfortable', 36, 48, 8],
    ['standard', 30, 42, 8],
    ['compact', 24, 36, 6],
  ] as const)('uses matching CSS and virtual row sizes for %s', (density, row, header, padding) => {
    const params = getDensityParams(density);
    const variables = resolveDataGridDensityVariables(params);
    expect(resolveDataGridRowHeight(params)).toBe(row);
    expect(variables['--gn-data-table-row-height']).toBe(`max(22px, calc(${row}px * var(--gn-ui-scale, 1)))`);
    expect(variables['--gn-data-table-header-height']).toBe(`calc(${header}px * var(--gn-ui-scale, 1))`);
    expect(variables['--gn-data-table-cell-inline-padding']).toBe(`calc(${padding}px * var(--gn-ui-scale, 1))`);
    const gridCss = buildDataGridDensityCss('.sample-grid', params);
    for (const [name, value] of Object.entries(variables)) expect(gridCss).toContain(`${name}: ${value};`);
    expect(gridCss).toMatch(/^\.sample-grid \{/);
  });

  it('scales the virtual window with the CSS row height while preserving space for controls', () => {
    expect(resolveDataGridRowHeight(getDensityParams('comfortable'), 0.8)).toBeCloseTo(28.8);
    expect(resolveDataGridRowHeight(getDensityParams('standard'), 1.25)).toBe(37.5);
    expect(resolveDataGridRowHeight(getDensityParams('compact'), 0.8)).toBe(22);
    expect(resolveDataGridRowHeight(getDensityParams('compact'), 1.25)).toBe(30);
    expect(resolveDataGridRowHeight(getDensityParams('compact'), Number.NaN)).toBe(24);
  });

  it('keeps user font settings independent and handles older partial geometry', () => {
    expect(resolveDataGridRowHeight({})).toBe(36);
    const css = buildDataGridDensityCss('.sample-grid', {});
    expect(css).not.toMatch(/NaN|undefined|font-size/);
  });
});
