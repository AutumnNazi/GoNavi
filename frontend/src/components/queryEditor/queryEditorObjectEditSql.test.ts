import { describe, expect, it } from 'vitest';

import {
    buildQueryEditorEditableDefinitionSql,
    buildQueryEditorQualifiedObjectName,
    buildQueryEditorRoutineEditFallbackSql,
    ensureQueryEditorObjectEditSqlTerminator,
    normalizeQueryEditorMySQLViewDDL,
    normalizeQueryEditorRoutineDefinitionForEdit,
} from './queryEditorObjectEditSql';
import {
    buildQueryEditorPackageDefinitionQueries,
    buildQueryEditorSequenceDefinitionQueries,
    buildQueryEditorViewDefinitionQueries,
    extractQueryEditorPackageDefinition,
    extractQueryEditorSequenceDefinition,
    extractQueryEditorViewDefinition,
} from './queryEditorObjectDefinitionQueries';

describe('query editor object edit sql', () => {
    it('keeps SQL*Plus slash terminators and otherwise appends a semicolon', () => {
        expect(ensureQueryEditorObjectEditSqlTerminator('CREATE VIEW v AS SELECT 1')).toBe('CREATE VIEW v AS SELECT 1;');
        expect(ensureQueryEditorObjectEditSqlTerminator('BEGIN\nNULL;\nEND;\n/')).toBe('BEGIN\nNULL;\nEND;\n/');
    });

    it('rewrites MySQL SHOW CREATE VIEW output into CREATE OR REPLACE VIEW', () => {
        expect(normalizeQueryEditorMySQLViewDDL('CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select 1')).toBe(
            'CREATE OR REPLACE VIEW `v` AS select 1;',
        );
        expect(normalizeQueryEditorMySQLViewDDL('SELECT 1')).toBe('SELECT 1');
    });

    it('wraps routine bodies that are not already CREATE statements', () => {
        expect(normalizeQueryEditorRoutineDefinitionForEdit('BEGIN RETURN 1; END', 'fn', 'FUNCTION')).toContain('CREATE OR REPLACE FUNCTION fn');
        expect(normalizeQueryEditorRoutineDefinitionForEdit('CREATE FUNCTION fn() BEGIN END', 'fn', 'FUNCTION')).toBe('CREATE FUNCTION fn() BEGIN END');
        expect(buildQueryEditorRoutineEditFallbackSql('do_work', 'PROCEDURE')).toContain('CREATE OR REPLACE PROCEDURE do_work()');
    });

    it('qualifies unqualified object names and builds an editable view definition', () => {
        expect(buildQueryEditorQualifiedObjectName('orders', 'sales')).toBe('sales.orders');
        expect(buildQueryEditorQualifiedObjectName('sales.orders', 'sales')).toBe('sales.orders');
        expect(buildQueryEditorEditableDefinitionSql('view-def', 'SELECT 1', 'v', 'View')).toContain('CREATE OR REPLACE VIEW v AS\nSELECT 1;');
    });

    it('builds dialect-specific definition queries and extracts definitions from rows', () => {
        expect(buildQueryEditorViewDefinitionQueries('mysql', 'v', 'app')).toEqual(expect.arrayContaining([
            'SHOW CREATE VIEW `v`',
        ]));
        expect(buildQueryEditorSequenceDefinitionQueries('oracle', 'seq', 'HR')).toEqual(expect.arrayContaining([
            expect.stringContaining('ALL_SEQUENCES'),
        ]));
        expect(buildQueryEditorPackageDefinitionQueries('oracle', 'pkg', 'HR')[0]).toContain("TYPE = 'PACKAGE'");
        expect(extractQueryEditorViewDefinition('postgres', [{ view_definition: 'SELECT 1' }])).toBe('SELECT 1');
        expect(extractQueryEditorSequenceDefinition([{ sequence_name: 'seq', increment_by: 2 }], 'seq', 'HR')).toContain('CREATE SEQUENCE HR.seq');
        expect(extractQueryEditorPackageDefinition([{ TEXT: 'PACKAGE pkg IS' }, { TEXT: ' END;' }])).toBe('PACKAGE pkg IS END;');
    });
});
