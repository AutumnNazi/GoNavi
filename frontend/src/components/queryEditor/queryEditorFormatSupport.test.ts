import { describe, expect, it } from 'vitest';

import { normalizeBrowserSQLExportFileName } from './queryEditorBrowser';
import {
    formatQueryEditorFormatError,
    normalizeQueryEditorFormatLogField,
    supportsPositionalSqlFormatParams,
} from './queryEditorFormatSupport';

describe('query editor format and browser helpers', () => {
    it('normalizes exported SQL file names', () => {
        expect(normalizeBrowserSQLExportFileName('C:/tmp/my query.sql')).toBe('my query.sql');
        expect(normalizeBrowserSQLExportFileName('report')).toBe('report.sql');
        expect(normalizeBrowserSQLExportFileName('a:b?.txt')).toBe('a_b_.txt.sql');
    });

    it('sanitizes formatter errors and log fields', () => {
        expect(formatQueryEditorFormatError(new Error('Unexpected "foo" near bar'))).toBe('Unexpected <token> near bar');
        expect(normalizeQueryEditorFormatLogField('My SQL!', '(unknown)')).toBe('my_sql_');
        expect(normalizeQueryEditorFormatLogField('', '(unknown)')).toBe('(unknown)');
    });

    it('enables positional format params for Dameng and OceanBase Oracle', () => {
        expect(supportsPositionalSqlFormatParams({ type: 'dameng' })).toBe(true);
        expect(supportsPositionalSqlFormatParams({ type: 'mysql' })).toBe(false);
        expect(supportsPositionalSqlFormatParams({ type: 'oceanbase', oceanBaseProtocol: 'oracle' })).toBe(true);
    });
});
