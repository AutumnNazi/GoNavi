import { t as translate } from '../../i18n';

export const QUERY_EDITOR_SQL_PROMPT_PLACEHOLDER = '{SQL}';

export const buildQueryEditorAiContextPrompt = (connection: {
    name?: string;
    config?: { type?: string };
} | null | undefined, database: string): string => {
    if (!connection) {
        return '';
    }

    const sourceLabel = String(connection.config?.type || '').trim() || translate('query_editor.ai_prompt.default_source');
    const databaseLabel = String(database || '').trim() || translate('query_editor.ai_prompt.default_database');

    return translate('query_editor.ai_prompt.context', {
        type: sourceLabel,
        name: `"${connection.name}"`,
        database: `"${databaseLabel}"`,
    });
};

export const resolveQueryEditorAiConnectionHost = (connection: {
    config?: {
        hosts?: unknown;
        host?: unknown;
        hostname?: unknown;
        server?: unknown;
        address?: unknown;
    };
} | null | undefined): string => {
    const config = connection?.config || {};
    if (Array.isArray(config.hosts)) {
        const hosts = config.hosts
            .map((item) => String(
                typeof item === 'string'
                    ? item
                    : (item && typeof item === 'object'
                        ? ((item as { host?: unknown; hostname?: unknown; address?: unknown }).host
                            || (item as { hostname?: unknown }).hostname
                            || (item as { address?: unknown }).address
                            || '')
                        : ''),
            ).trim())
            .filter(Boolean);
        if (hosts.length > 0) {
            return hosts.join(', ');
        }
    }
    return String(config.host || config.hostname || config.server || config.address || '').trim();
};
