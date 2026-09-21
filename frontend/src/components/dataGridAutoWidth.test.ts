import { describe, expect, it } from 'vitest';

import {
  calculateAutoFitColumnWidth,
  calculateAutoFitColumnWidths,
  normalizeAutoFitCellText,
} from './dataGridAutoWidth';

const measure = (text: string) => text.length * 8;

describe('dataGridAutoWidth helpers', () => {
  it('prefers the widest header or sampled value and adds padding', () => {
    const width = calculateAutoFitColumnWidth({
      headerTexts: ['user_name'],
      valueTexts: ['alice', 'very_long_username_value'],
      measureHeaderText: measure,
      measureCellText: measure,
      padding: 32,
      minWidth: 80,
      maxWidth: 720,
      defaultWidth: 140,
    });

    expect(width).toBe('very_long_username_value'.length * 8 + 32);
  });

  it('measures multiline content by the longest visible line and clamps to max width', () => {
    const width = calculateAutoFitColumnWidth({
      headerTexts: ['notes'],
      valueTexts: ['short\nmuch much longer line here'],
      measureHeaderText: measure,
      measureCellText: measure,
      padding: 24,
      minWidth: 80,
      maxWidth: 160,
      defaultWidth: 140,
    });

    expect(width).toBe(160);
  });

  it('normalizes null and oversized object values into stable preview text', () => {
    expect(normalizeAutoFitCellText(null)).toBe('NULL');
    expect(normalizeAutoFitCellText({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(normalizeAutoFitCellText(Array.from({ length: 81 }, (_, index) => index))).toBe('[Array(81)]');
  });

  it('calculates all initial column widths before the grid first renders', () => {
    const widths = calculateAutoFitColumnWidths({
      columnNames: ['id', 'name'],
      rows: [{ id: 1, name: 'long display name' }],
      dataFontSize: 13,
      defaultWidth: 100,
      minWidth: 80,
      maxWidth: 720,
      measureTextWidth: (text) => text.length * 8,
    });

    expect(widths.id).toBe(100);
    expect(widths.name).toBe('long display name'.length * 8 + 20);
  });
});
