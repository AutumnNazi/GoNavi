import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { normalizeSQLExportOptions } from './SQLExportOptionsDialog';

describe('SQLExportOptionsDialog', () => {
  it('keeps DROP IF EXISTS disabled unless the user explicitly enables it', () => {
    expect(normalizeSQLExportOptions()).toEqual({ includeDropIfExists: false });
    expect(normalizeSQLExportOptions({ includeDropIfExists: false })).toEqual({ includeDropIfExists: false });
    expect(normalizeSQLExportOptions({ includeDropIfExists: true })).toEqual({ includeDropIfExists: true });
  });

  it('shows a destructive-data warning beside the opt-in checkbox', () => {
    const source = readFileSync(new URL('./SQLExportOptionsDialog.tsx', import.meta.url), 'utf8');

    expect(source).toContain("t('data_export.sql_options.title')");
    expect(source).toContain("t('data_export.sql_options.drop_if_exists.label')");
    expect(source).toContain("t('data_export.sql_options.drop_if_exists.description')");
    expect(source).toContain('type="warning"');
    expect(source).toContain('includeDropIfExists: event.target.checked');
    expect(source).toContain('closable: true');
    expect(source).toContain('maskClosable: true');
    expect(source).toContain('onCancel: () => finish(null)');
  });
});
