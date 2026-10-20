import { v4 as uuid } from 'uuid';
import { CancelQuery, DBQueryApplicationWithCancel } from '../../../wailsjs/go/app/App';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
import { splitQualifiedNameSegmentsDetailed } from '../../utils/qualifiedName';
import { isMysqlFamilyDialect, isOracleLikeDialect, quoteSqlIdentifierPart } from '../../utils/sqlDialect';
import { getMetadataDialect, parseMetadataRowCount } from './sidebarMetadataBasics';
import type { SavedConnection } from '../../types';
import type { SidebarTreeNode } from '../sidebarV2Utils';
import type { SidebarLoadedTableEntry } from './sidebarTreeLoaderHelpers';

export const sidebarTableCountIdentity = (tableName: string, schemaName = ''): string => JSON.stringify([schemaName, tableName]);
export interface SidebarRowCountOptions {
    signal?: AbortSignal;
    onCount?: (counts: Map<string, number>) => void;
}

export const matchSidebarRowCountTables = (
    conn: SavedConnection & { dbName: string }, entries: SidebarLoadedTableEntry[],
    requestedTables: string[], selectedSchema = '',
) => {
    const dialect = getMetadataDialect(conn);
    const mysql = isMysqlFamilyDialect(dialect);
    const tables = entries.map((entry) => {
        // MySQL 返回的是裸表名，表名内的点不能当作库名分隔符。
        const parts = mysql ? [] : splitQualifiedNameSegmentsDetailed(entry.tableName, dialect);
        const name = parts.length ? parts[parts.length - 1].value : entry.tableName;
        const schema = mysql ? '' : parts.length > 1 ? parts.slice(0, -1).map((part) => part.value).join('.') : entry.schemaName;
        return { entry, name, schema };
    });
    const requested = requestedTables.map((target) => {
        const parts = splitQualifiedNameSegmentsDetailed(target, dialect);
        const name = parts[parts.length - 1]?.value;
        const exact = tables.filter((table) => table.name === name);
        const candidates = exact.length || !mysql ? exact
            : tables.filter((table) => table.name.toLowerCase() === name?.toLowerCase());
        const schema = parts.length > 1 ? parts.slice(0, -1).map((part) => part.value).join('.') : '';
        if (schema) return candidates.filter((table) => table.schema === schema);
        if (selectedSchema) return candidates.filter((table) => !table.schema || table.schema === selectedSchema);
        return candidates.length === 1 ? candidates : [];
    });
    return [...new Set(requested.flat())];
};

export const refreshSidebarTableRowCounts = async (
    conn: SavedConnection & { dbName: string },
    entries: SidebarLoadedTableEntry[],
    requestedTables: string[],
    selectedSchema = '',
    options: SidebarRowCountOptions = {},
): Promise<Map<string, number>> => {
    const dialect = getMetadataDialect(conn);
    const counts = new Map<string, number>();
    for (const table of matchSidebarRowCountTables(conn, entries, requestedTables, selectedSchema)) {
        if (options.signal?.aborted) break;
        const path = [
            ...((table.schema || (isOracleLikeDialect(dialect) ? conn.dbName : ''))
                ? [table.schema || conn.dbName] : []),
            table.name,
        ].map((part) => quoteSqlIdentifierPart(dialect, part)).join('.');
        const queryId = `sidebar-count-${uuid()}`;
        const cancel = () => { void CancelQuery(queryId).catch(() => undefined); };
        options.signal?.addEventListener('abort', cancel, { once: true });
        try {
            const result = await DBQueryApplicationWithCancel(buildRpcConnectionConfig(conn.config),
                conn.dbName, `SELECT COUNT(*) AS table_rows FROM ${path}`, queryId);
            if (options.signal?.aborted) break;
            const rows = result.success && Array.isArray(result.data) ? result.data : [];
            const count = rows.length ? parseMetadataRowCount(rows[0] as Record<string, unknown>) : undefined;
            if (count !== undefined) {
                const identity = sidebarTableCountIdentity(table.entry.tableName, table.entry.schemaName);
                counts.set(identity, count);
                options.onCount?.(new Map([[identity, count]]));
            }
            else console.warn('GoNavi sidebar row count refresh failed', table.entry.tableName, result.message);
        } catch (error) {
            if (options.signal?.aborted) break;
            console.warn('GoNavi sidebar row count refresh failed', table.entry.tableName, error);
        } finally {
            options.signal?.removeEventListener('abort', cancel);
        }
    }
    return counts;
};

export const applySidebarTableRowCounts = (nodes: SidebarTreeNode[], counts: Map<string, number>): SidebarTreeNode[] => (
    nodes.map((node) => {
        const count = node.dataRef?.tableName
            ? counts.get(sidebarTableCountIdentity(node.dataRef.tableName, node.dataRef.schemaName || '')) : undefined;
        return {
            ...node,
            ...(count !== undefined ? { dataRef: { ...node.dataRef, rowCount: count } } : {}),
            ...(node.children ? { children: applySidebarTableRowCounts(node.children, counts) } : {}),
        };
    })
);
