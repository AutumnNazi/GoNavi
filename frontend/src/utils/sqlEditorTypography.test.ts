import { describe, expect, it } from 'vitest';

import {
  migrateLegacySqlEditorTypographySettings,
  resolveSqlEditorFontSize,
  sanitizeSqlEditorTypographySettings,
} from './sqlEditorTypography';

describe('SQL editor typography', () => {
  it('derives a code-sized value while following the global font size', () => {
    expect(resolveSqlEditorFontSize({
      globalFontSize: 14,
      sqlEditorFontSize: 20,
      sqlEditorFontSizeFollowGlobal: true,
    })).toBe(13);
  });

  it('uses and clamps an independent SQL editor font size', () => {
    expect(resolveSqlEditorFontSize({
      globalFontSize: 14,
      sqlEditorFontSize: 99,
      sqlEditorFontSizeFollowGlobal: false,
    })).toBe(20);
    expect(sanitizeSqlEditorTypographySettings({
      sqlEditorFontSize: 9,
      sqlEditorFontSizeFollowGlobal: false,
    })).toEqual({
      sqlEditorFontSize: 10,
      sqlEditorFontSizeFollowGlobal: false,
    });
  });

  it('preserves the legacy editor size derived from a custom data-table font', () => {
    expect(migrateLegacySqlEditorTypographySettings({
      dataTableFontSize: 18,
      dataTableFontSizeFollowGlobal: false,
    })).toEqual({
      sqlEditorFontSize: 17,
      sqlEditorFontSizeFollowGlobal: false,
    });
  });
});
