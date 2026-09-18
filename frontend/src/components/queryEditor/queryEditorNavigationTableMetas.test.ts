import { describe, expect, it } from 'vitest';

import { buildQueryEditorNavigationTableMetas } from './queryEditorNavigationTableMetas';

const tables = [
    { dbName: 'Demo', tableName: 'users' },
    { dbName: 'Demo', tableName: 'Sales.Orders' },
    { dbName: 'other', tableName: 'logs' },
];

describe('buildQueryEditorNavigationTableMetas', () => {
    it('normalizes catalog rows into lookup metas', () => {
        const metas = buildQueryEditorNavigationTableMetas(tables, 'mysql', false);

        expect(metas).toHaveLength(3);
        expect(metas[0]).toMatchObject({
            dbName: 'Demo',
            rawTableName: 'users',
            normalizedDbName: 'demo',
            normalizedRawTableName: 'users',
            normalizedObjectName: 'users',
            schemaName: '',
        });
        expect(metas[1]).toMatchObject({
            rawTableName: 'Sales.Orders',
            normalizedRawTableName: 'sales.orders',
            normalizedObjectName: 'orders',
            schemaName: 'Sales',
            normalizedSchemaName: 'sales',
        });
    });
    it('reuses the normalized result for the same source array', () => {
        const first = buildQueryEditorNavigationTableMetas(tables, 'mysql', false);
        const second = buildQueryEditorNavigationTableMetas(tables, 'mysql', false);

        // Identity reuse (not just deep equality) is what keeps repeated
        // decoration refreshes off the full-catalog normalization path.
        expect(second).toBe(first);
    });

    it('separates cache entries by dialect and scope', () => {
        const folded = buildQueryEditorNavigationTableMetas(tables, 'mysql', false);
        const postgres = buildQueryEditorNavigationTableMetas(tables, 'postgres', false);
        const sqlite = buildQueryEditorNavigationTableMetas(tables, 'sqlite', true);

        expect(folded).not.toBe(postgres);
        expect(folded).not.toBe(sqlite);
        // PostgreSQL catalogs preserve case for quoted identifiers, so the identity
        // key differs from the case-folded dialect even for the same source row.
        expect(folded[1].metadataDbKey).toBe('demo');
        expect(postgres[1].metadataDbKey).toBe('Demo');
        // Connection-scoped sources treat a dot as object data, not a separator.
        expect(folded[1].normalizedObjectName).toBe('orders');
        expect(sqlite[1].normalizedObjectName).toBe('sales.orders');
        expect(sqlite[1].schemaName).toBe('');
    });

    it('rebuilds when the catalog array is replaced', () => {
        const first = buildQueryEditorNavigationTableMetas(tables, 'mysql', false);
        const replaced = [...tables];
        const second = buildQueryEditorNavigationTableMetas(replaced, 'mysql', false);

        expect(second).not.toBe(first);
        expect(second).toHaveLength(first.length);
    });
});
