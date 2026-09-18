import { buildMetadataIdentityKey } from '../../utils/metadataIdentity';
import {
    splitMetadataQualifiedName,
    splitQualifiedNameSegmentsDetailed,
    type QualifiedNameSegment,
} from '../../utils/qualifiedName';
import { splitSidebarQualifiedName } from '../../utils/sidebarLocate';

export type QueryEditorNamedObjectMeta = {
    dbName: string;
    rawObjectName: string;
    objectName: string;
    schemaName: string;
    metadataDbKey: string;
    normalizedDbName: string;
    normalizedRawObjectName: string;
    normalizedObjectName: string;
    normalizedSchemaName: string;
    identifierSegments: QualifiedNameSegment[];
};

export type QueryEditorTriggerObjectMeta = QueryEditorNamedObjectMeta & { tableName: string };
export type QueryEditorRoutineObjectMeta = QueryEditorNamedObjectMeta & { routineType: string };

type NamedObjectSource = { dbName: string; schemaName?: string };

const FALLBACK_ROUTINE_TYPE = 'FUNCTION';

const buildNamedObjectMeta = (
    dbName: string,
    rawObjectName: string,
    explicitSchemaName: string,
    dialect: string,
): QueryEditorNamedObjectMeta => {
    const trimmedDbName = String(dbName || '').trim();
    const trimmedObjectName = String(rawObjectName || '').trim();
    const trimmedSchemaName = String(explicitSchemaName || '').trim();
    const parsedMetadata = trimmedSchemaName
        ? splitMetadataQualifiedName(trimmedObjectName, trimmedSchemaName)
        : null;
    const parsedLegacy = parsedMetadata ? null : splitSidebarQualifiedName(trimmedObjectName);
    const schemaName = String(
        trimmedSchemaName
        || parsedMetadata?.parentPath
        || parsedLegacy?.schemaName
        || '',
    ).trim();
    const objectName = String(
        parsedMetadata?.objectName
        || parsedLegacy?.objectName
        || trimmedObjectName,
    ).trim();
    return {
        dbName: trimmedDbName,
        rawObjectName: trimmedObjectName,
        objectName,
        schemaName,
        metadataDbKey: buildMetadataIdentityKey(dialect, trimmedDbName),
        normalizedDbName: trimmedDbName.toLowerCase(),
        normalizedRawObjectName: trimmedObjectName.toLowerCase(),
        normalizedObjectName: objectName.toLowerCase(),
        normalizedSchemaName: schemaName.toLowerCase(),
        identifierSegments: splitQualifiedNameSegmentsDetailed(
            schemaName ? `${schemaName}.${objectName}` : trimmedObjectName,
            dialect,
        ),
    };
};

// The query editor resolves one navigation target per identifier candidate on every decoration
// refresh, and every call used to re-normalize the whole non-table catalog on the way to a match.
// Triggers, routines and sequences dominate the catalogs that made typing stutter -- their counts
// far exceed tables, so caching only the table half still re-parsed thousands of rows per candidate.
// Catalog refreshes replace these arrays, so keying by array identity keeps this correct.
const namedObjectMetaCache = new WeakMap<readonly NamedObjectSource[], Map<string, unknown[]>>();

const getCachedVariants = <TResult>(
    sources: readonly NamedObjectSource[],
    variantKey: string,
    build: () => TResult[],
): TResult[] => {
    if (sources.length === 0) {
        return [];
    }
    let cacheByVariant = namedObjectMetaCache.get(sources);
    if (!cacheByVariant) {
        cacheByVariant = new Map<string, unknown[]>();
        namedObjectMetaCache.set(sources, cacheByVariant);
    }
    const cached = cacheByVariant.get(variantKey);
    if (cached) {
        return cached as TResult[];
    }
    const metas = build();
    cacheByVariant.set(variantKey, metas);
    return metas;
};

export const buildQueryEditorNamedObjectMetas = (
    sources: readonly NamedObjectSource[],
    nameKey: 'viewName' | 'sequenceName' | 'packageName',
    dialect: string,
): QueryEditorNamedObjectMeta[] => getCachedVariants(
    sources,
    `${nameKey}\u0000${dialect}`,
    () => sources.map((source) => buildNamedObjectMeta(
        source.dbName,
        String((source as Record<string, unknown>)[nameKey] || ''),
        String(source.schemaName || ''),
        dialect,
    )),
);

export const buildQueryEditorTriggerObjectMetas = (
    sources: readonly (NamedObjectSource & { triggerName: string; tableName: string })[],
    dialect: string,
): QueryEditorTriggerObjectMeta[] => getCachedVariants(
    sources,
    `triggerName\u0000${dialect}`,
    () => sources.map((source) => ({
        ...buildNamedObjectMeta(source.dbName, source.triggerName, String(source.schemaName || ''), dialect),
        tableName: String(source.tableName || '').trim(),
    })),
);

export const buildQueryEditorRoutineObjectMetas = (
    sources: readonly (NamedObjectSource & { routineName: string; routineType: string })[],
    dialect: string,
): QueryEditorRoutineObjectMeta[] => getCachedVariants(
    sources,
    `routineName\u0000${dialect}`,
    () => sources.map((source) => ({
        ...buildNamedObjectMeta(source.dbName, source.routineName, String(source.schemaName || ''), dialect),
        routineType: String(source.routineType || '').trim().toUpperCase() || FALLBACK_ROUTINE_TYPE,
    })),
);
