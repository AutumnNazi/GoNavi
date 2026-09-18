import { describe, expect, it } from 'vitest';

import {
    buildQueryEditorNamedObjectMetas,
    buildQueryEditorRoutineObjectMetas,
    buildQueryEditorTriggerObjectMetas,
} from './queryEditorNamedObjectMetas';

// These shapes mirror the Completion*Meta types the real callers pass; declaring them
// as variables keeps TypeScript's excess-property check off the inline literals.
const views: { dbName: string; viewName: string }[] = [
    { dbName: 'Demo', viewName: 'v_active_users' },
];
const triggers: { dbName: string; triggerName: string; tableName: string }[] = [
    { dbName: 'Demo', triggerName: 'trg_audit', tableName: 'users' },
];
const routines: { dbName: string; routineName: string; routineType: string }[] = [
    { dbName: 'Demo', routineName: 'fn_calc', routineType: 'function' },
];
const sequences: { dbName: string; sequenceName: string }[] = [
    { dbName: 'Demo', sequenceName: 'seq_order_id' },
];
const packages: { dbName: string; packageName: string }[] = [
    { dbName: 'Demo', packageName: 'pkg_billing' },
];
const dottedView: { dbName: string; viewName: string }[] = [
    { dbName: 'Demo', viewName: 'Sales.Orders' },
];
const schemaQualifiedView: { dbName: string; viewName: string; schemaName: string }[] = [
    { dbName: 'Demo', viewName: 'Orders', schemaName: 'Reporting' },
];

describe('buildQueryEditorNamedObjectMetas', () => {
    it('normalizes a catalog row into a lookup meta', () => {
        const [meta] = buildQueryEditorNamedObjectMetas(sequences, 'sequenceName', 'mysql');

        expect(meta).toMatchObject({
            dbName: 'Demo',
            rawObjectName: 'seq_order_id',
            objectName: 'seq_order_id',
            schemaName: '',
            normalizedDbName: 'demo',
            normalizedRawObjectName: 'seq_order_id',
            normalizedObjectName: 'seq_order_id',
        });
    });

    it('splits a dotted object name into schema and object', () => {
        const [meta] = buildQueryEditorNamedObjectMetas(dottedView, 'viewName', 'postgres');

        expect(meta).toMatchObject({
            rawObjectName: 'Sales.Orders',
            objectName: 'Orders',
            schemaName: 'Sales',
            normalizedObjectName: 'orders',
            normalizedSchemaName: 'sales',
        });
        expect(meta.identifierSegments).toHaveLength(2);
    });

    it('honors an explicit schemaName over the parsed name', () => {
        const [meta] = buildQueryEditorNamedObjectMetas(schemaQualifiedView, 'viewName', 'mysql');

        expect(meta.schemaName).toBe('Reporting');
        expect(meta.objectName).toBe('Orders');
    });

    it('separates cache entries by dialect', () => {
        const folded = buildQueryEditorNamedObjectMetas(views, 'viewName', 'mysql');
        const postgres = buildQueryEditorNamedObjectMetas(views, 'viewName', 'postgres');

        expect(folded).not.toBe(postgres);
        expect(folded[0].metadataDbKey).toBe('demo');
        expect(postgres[0].metadataDbKey).toBe('Demo');
    });

    it('reuses the normalized result for the same source array', () => {
        const first = buildQueryEditorNamedObjectMetas(views, 'viewName', 'mysql');
        const second = buildQueryEditorNamedObjectMetas(views, 'viewName', 'mysql');

        // Identity reuse (not just deep equality) is what keeps repeated decoration
        // refreshes off the full-catalog normalization path.
        expect(second).toBe(first);
    });

    it('does not collide across object families sharing one source shape', () => {
        const asViews = buildQueryEditorNamedObjectMetas(views, 'viewName', 'mysql');
        const asSequences = buildQueryEditorNamedObjectMetas(sequences, 'sequenceName', 'mysql');

        expect(asViews).not.toBe(asSequences);
        expect(asViews[0].objectName).toBe('v_active_users');
        expect(asSequences[0].objectName).toBe('seq_order_id');
    });

    it('rebuilds when the catalog array is replaced', () => {
        const first = buildQueryEditorNamedObjectMetas(views, 'viewName', 'mysql');
        const second = buildQueryEditorNamedObjectMetas([...views], 'viewName', 'mysql');

        expect(second).not.toBe(first);
        expect(second).toEqual(first);
    });

    it('handles an empty catalog', () => {
        const empty: { dbName: string; viewName: string }[] = [];

        expect(buildQueryEditorNamedObjectMetas(empty, 'viewName', 'mysql')).toEqual([]);
        expect(buildQueryEditorNamedObjectMetas(empty, 'viewName', 'mysql')).toEqual([]);
    });
});

describe('buildQueryEditorTriggerObjectMetas', () => {
    it('carries the owning table through', () => {
        const [meta] = buildQueryEditorTriggerObjectMetas(triggers, 'mysql');

        expect(meta).toMatchObject({
            rawObjectName: 'trg_audit',
            tableName: 'users',
        });
        expect(meta.normalizedObjectName).toBe('trg_audit');
    });

    it('reuses the normalized result for the same source array', () => {
        expect(buildQueryEditorTriggerObjectMetas(triggers, 'mysql'))
            .toBe(buildQueryEditorTriggerObjectMetas(triggers, 'mysql'));
    });
});

describe('buildQueryEditorRoutineObjectMetas', () => {
    it('uppercases the routine type and falls back to FUNCTION when blank', () => {
        const metas = buildQueryEditorRoutineObjectMetas([
            ...routines,
            { dbName: 'Demo', routineName: 'sp_purge', routineType: '' },
        ], 'mysql');

        expect(metas[0].routineType).toBe('FUNCTION');
        // Downstream filters compare this against 'PROCEDURE'/'FUNCTION', so a blank
        // catalog value must not leave the type empty.
        expect(metas[1].routineType).toBe('FUNCTION');
    });

    it('preserves PROCEDURE', () => {
        const [meta] = buildQueryEditorRoutineObjectMetas(
            [{ dbName: 'Demo', routineName: 'sp_purge', routineType: 'procedure' }],
            'mysql',
        );

        expect(meta.routineType).toBe('PROCEDURE');
    });

    it('reuses the normalized result for the same source array', () => {
        expect(buildQueryEditorRoutineObjectMetas(routines, 'mysql'))
            .toBe(buildQueryEditorRoutineObjectMetas(routines, 'mysql'));
    });
});

describe('package metas', () => {
    it('normalizes packages like other named objects', () => {
        const [meta] = buildQueryEditorNamedObjectMetas(packages, 'packageName', 'oracle');

        expect(meta.objectName).toBe('pkg_billing');
    });
});
