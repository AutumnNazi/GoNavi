import { buildMetadataIdentityKey } from '../../utils/metadataIdentity';
import {
    splitQualifiedNameSegmentsDetailed,
    type QualifiedNameSegment,
} from '../../utils/qualifiedName';
import { splitSidebarQualifiedName } from '../../utils/sidebarLocate';

type NavigationTableSource = { dbName: string; tableName: string };

export type QueryEditorNavigationTableMeta = {
    dbName: string;
    rawTableName: string;
    metadataDbKey: string;
    normalizedDbName: string;
    normalizedRawTableName: string;
    normalizedObjectName: string;
    schemaName: string;
    normalizedSchemaName: string;
    identifierSegments: QualifiedNameSegment[];
};

// The query editor resolves one navigation target per identifier candidate on every decoration
// refresh, and each call used to re-normalize the entire catalog. Catalog refreshes replace the
// source array, so keying by array identity keeps this correct while making repeat lookups cheap.
const navigationTableMetaCache = new WeakMap<
    readonly NavigationTableSource[],
    Map<string, QueryEditorNavigationTableMeta[]>
>();

export const buildQueryEditorNavigationTableMetas = (
    tables: readonly NavigationTableSource[],
    dialect: string,
    connectionScopedDialect: boolean,
): QueryEditorNavigationTableMeta[] => {
    let cacheByVariant = navigationTableMetaCache.get(tables);
    if (!cacheByVariant) {
        cacheByVariant = new Map<string, QueryEditorNavigationTableMeta[]>();
        navigationTableMetaCache.set(tables, cacheByVariant);
    }
    // Both flags change how a catalog name is split, so they belong in the cache key.
    const cacheKey = `${connectionScopedDialect ? 'scoped' : 'qualified'}\u0000${dialect}`;
    const cached = cacheByVariant.get(cacheKey);
    if (cached) {
        return cached;
    }

    const metas = tables.map((table) => {
        const dbName = String(table.dbName || '').trim();
        const rawTableName = String(table.tableName || '').trim();
        // sqlite_master reports literal table names without quoting. A dot in
        // that catalog value is legal object data, not a schema separator.
        const parsed = connectionScopedDialect
            ? { schemaName: '', objectName: rawTableName }
            : splitSidebarQualifiedName(rawTableName);
        return {
            dbName,
            rawTableName,
            metadataDbKey: buildMetadataIdentityKey(dialect, dbName),
            normalizedDbName: dbName.toLowerCase(),
            normalizedRawTableName: rawTableName.toLowerCase(),
            normalizedObjectName: String(parsed.objectName || rawTableName).trim().toLowerCase(),
            schemaName: String(parsed.schemaName || '').trim(),
            normalizedSchemaName: String(parsed.schemaName || '').trim().toLowerCase(),
            identifierSegments: splitQualifiedNameSegmentsDetailed(rawTableName, dialect),
        };
    });
    cacheByVariant.set(cacheKey, metas);
    return metas;
};
