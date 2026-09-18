import { t as translate } from '../../i18n';
import type { ConnectionConfig, SavedConnection } from '../../types';
import {
  ensureDatabaseServerVersion,
  peekDatabaseServerVersion,
} from './queryEditorServerVersion';

export type QueryEditorAiPromptConnection = {
  id?: string;
  name?: string;
  config?: Partial<ConnectionConfig> & {
    hostname?: string;
    server?: string;
    address?: string;
  };
};

export const resolveQueryEditorAiConnectionHost = (
  connection: QueryEditorAiPromptConnection | SavedConnection | null | undefined,
): string => {
  const config = (connection?.config || {}) as NonNullable<QueryEditorAiPromptConnection['config']>;
  if (Array.isArray(config.hosts)) {
    const hosts = config.hosts
      .map((item) => String(typeof item === 'string' ? item : (item as { host?: string; hostname?: string; address?: string })?.host
        || (item as { hostname?: string })?.hostname
        || (item as { address?: string })?.address
        || '').trim())
      .filter(Boolean);
    if (hosts.length > 0) {
      return hosts.join(', ');
    }
  }
  return String(config.host || config.hostname || config.server || config.address || '').trim();
};

export const buildQueryEditorAiContextPrompt = (
  connection: QueryEditorAiPromptConnection | SavedConnection | null | undefined,
  database: string,
): string => {
  if (!connection) {
    return '';
  }

  const sourceLabel = String(connection.config?.type || '').trim() || translate('query_editor.ai_prompt.default_source');
  const databaseLabel = String(database || '').trim() || translate('query_editor.ai_prompt.default_database');
  const versionLabel = peekDatabaseServerVersion(connection.id)
    || translate('query_editor.ai_prompt.default_version');

  return translate('query_editor.ai_prompt.context', {
    type: sourceLabel,
    name: `"${connection.name}"`,
    database: `"${databaseLabel}"`,
    version: versionLabel,
  });
};

export const buildQueryEditorAiContextPromptAsync = async (
  connection: QueryEditorAiPromptConnection | SavedConnection | null | undefined,
  database: string,
): Promise<string> => {
  if (connection?.id && connection.config) {
    await ensureDatabaseServerVersion({
      id: connection.id,
      config: connection.config,
    });
  }
  return buildQueryEditorAiContextPrompt(connection, database);
};
