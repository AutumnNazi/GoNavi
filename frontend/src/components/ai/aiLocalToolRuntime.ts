import { DBGetAllColumns, DBGetDatabases, DBGetTables, ReadAppLogTail, ReadSQLFile } from '../../../wailsjs/go/app/App';
import { useStore } from '../../store';
import { isMacLikePlatform } from '../../utils/appearance';
import { getShortcutPlatform } from '../../utils/shortcuts';

import type { AISnapshotInspectionRuntime } from './aiSnapshotInspectionToolTypes';

export interface AIToolContextEntry {
  connectionId: string;
  dbName: string;
  tables: string[];
}

export interface AILocalToolRuntime extends AISnapshotInspectionRuntime {
  getDatabases: (config: any) => Promise<any>;
  getTables: (config: any, dbName: string) => Promise<any>;
  getAllColumns: (config: any, dbName: string) => Promise<any>;
  readAppLogTail: (lineLimit: number, keyword: string) => Promise<any>;
  readSQLFile: (filePath: string) => Promise<any>;
  getColumns: (config: any, dbName: string, tableName: string) => Promise<any>;
  getIndexes: (config: any, dbName: string, tableName: string) => Promise<any>;
  getForeignKeys: (config: any, dbName: string, tableName: string) => Promise<any>;
  getTriggers: (config: any, dbName: string, tableName: string) => Promise<any>;
  showCreateTable: (config: any, dbName: string, tableName: string) => Promise<any>;
  query: (config: any, dbName: string, sql: string) => Promise<any>;
  checkSQL?: (sql: string) => Promise<{ allowed?: boolean; operationType?: string } | undefined>;
  callMCPTool?: (name: string, args: string) => Promise<{ content?: string; isError?: boolean } | undefined>;
}

const getAIService = () => (window as any).go?.aiservice?.Service;

export const buildDefaultLocalToolRuntime = (): AILocalToolRuntime => ({
  getDatabases: DBGetDatabases,
  getTables: DBGetTables,
  getAllColumns: DBGetAllColumns,
  readAppLogTail: (lineLimit, keyword) => ReadAppLogTail(lineLimit, String(keyword || '')),
  readSQLFile: ReadSQLFile,
  getColumns: async (config, dbName, tableName) => {
    const mod = await import('../../../wailsjs/go/app/App');
    return mod.DBGetColumns(config, dbName, tableName);
  },
  getIndexes: async (config, dbName, tableName) => {
    const mod = await import('../../../wailsjs/go/app/App');
    return mod.DBGetIndexes(config, dbName, tableName);
  },
  getForeignKeys: async (config, dbName, tableName) => {
    const mod = await import('../../../wailsjs/go/app/App');
    return mod.DBGetForeignKeys(config, dbName, tableName);
  },
  getTriggers: async (config, dbName, tableName) => {
    const mod = await import('../../../wailsjs/go/app/App');
    return mod.DBGetTriggers(config, dbName, tableName);
  },
  showCreateTable: async (config, dbName, tableName) => {
    const mod = await import('../../../wailsjs/go/app/App');
    return mod.DBShowCreateTable(config, dbName, tableName);
  },
  query: async (config, dbName, sql) => {
    const mod = await import('../../../wailsjs/go/app/App');
    return mod.DBQueryAI(config, dbName, sql);
  },
  checkSQL: async (sql) => {
    const service = getAIService();
    if (typeof service?.AICheckSQL !== 'function') {
      return undefined;
    }
    return service.AICheckSQL(sql);
  },
  callMCPTool: async (name, args) => {
    const service = getAIService();
    if (typeof service?.AICallMCPTool !== 'function') {
      return undefined;
    }
    return service.AICallMCPTool(name, args);
  },
  getAIRuntimeState: async () => {
    const service = getAIService();
    if (!service) {
      return undefined;
    }
    const [providers, activeProviderId, safetyLevel, contextLevel] = await Promise.all([
      typeof service.AIGetProviders === 'function' ? service.AIGetProviders() : Promise.resolve([]),
      typeof service.AIGetActiveProvider === 'function' ? service.AIGetActiveProvider() : Promise.resolve(''),
      typeof service.AIGetSafetyLevel === 'function' ? service.AIGetSafetyLevel() : Promise.resolve(''),
      typeof service.AIGetContextLevel === 'function' ? service.AIGetContextLevel() : Promise.resolve(''),
    ]);
    return {
      providers: Array.isArray(providers) ? providers : [],
      activeProviderId: String(activeProviderId || '').trim(),
      safetyLevel: String(safetyLevel || '').trim(),
      contextLevel: String(contextLevel || '').trim(),
    };
  },
  getMCPServers: async () => {
    const service = getAIService();
    if (typeof service?.AIGetMCPServers !== 'function') {
      return undefined;
    }
    return service.AIGetMCPServers();
  },
  getMCPClientInstallStatuses: async () => {
    const service = getAIService();
    if (typeof service?.AIGetMCPClientInstallStatuses !== 'function') {
      return undefined;
    }
    return service.AIGetMCPClientInstallStatuses();
  },
  getSqlEditorTransactionState: async () => {
    const state = useStore.getState();
    return {
      ...state.sqlEditorTransactionOptions,
      pendingTransactions: state.sqlEditorPendingTransactions,
    };
  },
  getShortcutOptions: async () => useStore.getState().shortcutOptions,
  getShortcutPlatform: async () => getShortcutPlatform(isMacLikePlatform()),
});
