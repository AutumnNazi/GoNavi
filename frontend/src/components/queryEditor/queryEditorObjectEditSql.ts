import { DBQuery } from '../../../wailsjs/go/app/App';
import { t as translate } from '../../i18n';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
import { splitQueryIdentifierPathSegments } from './QueryEditorHelpers';

export const escapeQueryEditorObjectEditSqlLiteral = (value: unknown): string => (
    String(value || '').replace(/'/g, "''")
);

export const getQueryEditorObjectEditRawValue = (
    row: Record<string, unknown>,
    candidateKeys: string[],
): unknown => {
    const keyMap = new Map<string, unknown>();
    Object.keys(row || {}).forEach((key) => keyMap.set(key.toLowerCase(), row[key]));
    for (const key of candidateKeys) {
        if (keyMap.has(key.toLowerCase())) {
            const value = keyMap.get(key.toLowerCase());
            if (value !== undefined && value !== null) return value;
        }
    }
    return undefined;
};

export const normalizeQueryEditorRoutineDefinitionForEdit = (
    definition: string,
    routineName: string,
    routineType: string,
): string => {
    const text = String(definition || '').trim();
    if (!text) return '';
    if (/^\s*create\b/i.test(text)) return text;
    if (/^\s*(function|procedure)\b/i.test(text)) {
        return `CREATE OR REPLACE ${text}`;
    }
    const normalizedType = String(routineType || 'FUNCTION').trim().toUpperCase().includes('PROC')
        ? 'PROCEDURE'
        : 'FUNCTION';
    return `CREATE OR REPLACE ${normalizedType} ${routineName}\n${text}`;
};

export const buildQueryEditorRoutineEditFallbackSql = (
    routineName: string,
    routineType: string,
): string => {
    const normalizedType = String(routineType || 'FUNCTION').trim().toUpperCase().includes('PROC')
        ? 'PROCEDURE'
        : 'FUNCTION';
    if (normalizedType === 'PROCEDURE') {
        return `CREATE OR REPLACE PROCEDURE ${routineName}()\nBEGIN\n    -- TODO: edit procedure body\nEND;`;
    }
    return `CREATE OR REPLACE FUNCTION ${routineName}()\nRETURNS INTEGER\nBEGIN\n    -- TODO: edit function body\n    RETURN 0;\nEND;`;
};

export const normalizeQueryEditorMySQLViewDDL = (rawDefinition: unknown): string => {
    const text = String(rawDefinition || '').trim();
    if (!text) return '';

    const normalized = text.replace(/\r\n/g, '\n').trim().replace(/;+\s*$/, '');
    const createViewPrefixPattern = /^\s*create\s+(?:algorithm\s*=\s*\w+\s+)?(?:definer\s*=\s*(?:`[^`]+`|\S+)\s*@\s*(?:`[^`]+`|\S+)\s+)?(?:sql\s+security\s+(?:definer|invoker)\s+)?view\s+/i;
    if (createViewPrefixPattern.test(normalized)) {
        return `${normalized.replace(createViewPrefixPattern, 'CREATE OR REPLACE VIEW ')};`;
    }

    if (/^\s*(select|with)\b/i.test(normalized)) {
        return normalized;
    }

    return `${normalized};`;
};

export const normalizeQueryEditorSqlPlusSlashTerminator = (sql: string): string => (
    String(sql || '').trim().replace(/(^|\n)([ \t]*\/[ \t]*);+([ \t]*(?:--[^\n]*)?)\s*$/i, '$1$2$3')
);

export const hasQueryEditorSqlPlusSlashTerminator = (sql: string): boolean => (
    /(?:^|\n)[ \t]*\/[ \t]*(?:--[^\n]*)?\s*$/i.test(String(sql || '').trim())
);

export const ensureQueryEditorObjectEditSqlTerminator = (sql: string): string => {
    const normalized = normalizeQueryEditorSqlPlusSlashTerminator(sql);
    if (!normalized) return '';
    if (hasQueryEditorSqlPlusSlashTerminator(normalized)) return normalized;
    return /;\s*$/.test(normalized) ? normalized : `${normalized};`;
};

export const isQueryEditorCommentOnlyDefinition = (definition: string): boolean => {
    const normalized = String(definition || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return false;
    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.length > 0 && lines.every((line) => line.startsWith('--'));
};

export const withQueryEditorCreateOrReplacePackageHeaders = (definition: string): string => {
    const normalized = String(definition || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';
    return normalized
        .split(/(?=^\s*PACKAGE(?:\s+BODY)?\b)/gim)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (/^\s*CREATE\b/i.test(part) ? part : `CREATE OR REPLACE ${part}`))
        .join('\n/\n');
};

export const buildQueryEditorQualifiedObjectName = (objectName: string, schemaName?: string): string => {
    const normalizedObjectName = String(objectName || '').trim();
    const normalizedSchemaName = String(schemaName || '').trim();
    if (
        !normalizedObjectName
        || !normalizedSchemaName
        || splitQueryIdentifierPathSegments(normalizedObjectName).length > 1
    ) {
        return normalizedObjectName;
    }
    return `${normalizedSchemaName}.${normalizedObjectName}`;
};

export const buildQueryEditorEditableDefinitionSql = (
    objectType: 'view-def' | 'sequence-def' | 'package-def',
    definition: string,
    objectName: string,
    objectLabel: string,
): string => {
    const normalizedDefinition = String(definition || '').trim();
    const header = [
        `-- ${translate('definition_viewer.edit.comment_title', { object: objectLabel, name: objectName })}`,
        `-- ${translate('definition_viewer.edit.comment_compatibility')}`,
    ].join('\n') + '\n';
    if (!normalizedDefinition) {
        return `${header}-- ${translate('definition_viewer.edit.comment_empty_definition', { name: objectName })}\n`;
    }

    if (isQueryEditorCommentOnlyDefinition(normalizedDefinition)) {
        return `${header}${ensureQueryEditorObjectEditSqlTerminator(normalizedDefinition)}`;
    }

    if (objectType === 'view-def' && !/^\s*create\b/i.test(normalizedDefinition)) {
        if (/^\s*view\b/i.test(normalizedDefinition)) {
            return `${header}${ensureQueryEditorObjectEditSqlTerminator(normalizedDefinition.replace(/^\s*view\b/i, 'CREATE OR REPLACE VIEW'))}`;
        }
        return `${header}CREATE OR REPLACE VIEW ${objectName} AS\n${ensureQueryEditorObjectEditSqlTerminator(normalizedDefinition)}`;
    }

    if (objectType === 'sequence-def' && !/^\s*create\b/i.test(normalizedDefinition)) {
        return `${header}${ensureQueryEditorObjectEditSqlTerminator(`CREATE SEQUENCE ${objectName}\n${normalizedDefinition}`)}`;
    }

    if (
        objectType === 'package-def'
        && !/^\s*create\b/i.test(normalizedDefinition)
        && /^\s*package\b/i.test(normalizedDefinition)
    ) {
        return `${header}${withQueryEditorCreateOrReplacePackageHeaders(normalizedDefinition)}`;
    }

    return `${header}${ensureQueryEditorObjectEditSqlTerminator(normalizedDefinition)}`;
};

export const buildQueryEditorObjectDefinitionConnectionConfig = (conn: {
    config?: {
        port?: unknown;
        password?: unknown;
        database?: unknown;
        useSSH?: unknown;
        ssh?: unknown;
    };
}): Record<string, unknown> => ({
    ...conn.config,
    port: Number(conn.config?.port),
    password: conn.config?.password || '',
    database: conn.config?.database || '',
    useSSH: conn.config?.useSSH || false,
    ssh: conn.config?.ssh || { host: '', port: 22, user: '', password: '', keyPath: '' },
});

export const runQueryEditorObjectDefinitionCandidates = async (
    config: Record<string, unknown>,
    dbName: string,
    queries: string[],
    collectAll = false,
): Promise<Record<string, unknown>[]> => {
    const collectedRows: Record<string, unknown>[] = [];
    for (const query of queries) {
        const sql = String(query || '').trim();
        if (!sql || sql.startsWith('--')) continue;
        try {
            const result = await DBQuery(buildRpcConnectionConfig(config), dbName, sql);
            if (!result.success || !Array.isArray(result.data) || result.data.length === 0) {
                continue;
            }
            if (!collectAll) {
                return result.data as Record<string, unknown>[];
            }
            collectedRows.push(...(result.data as Record<string, unknown>[]));
        } catch {
            // 元数据定义读取失败时保留编辑模板。
        }
    }
    return collectedRows;
};
