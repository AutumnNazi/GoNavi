import type { SavedConnection, TabData } from '../../types';
import { t as translateCatalog, type I18nParams } from '../../i18n';
import { peekDatabaseServerVersion } from '../queryEditor/queryEditorServerVersion';

type AIInspectionTranslator = (key: string, params?: I18nParams) => string;

const translateInspectionCopy = (
  translate: AIInspectionTranslator | undefined,
  key: string,
  fallback: string,
): string => {
  const t = translate || ((catalogKey, params) => translateCatalog(catalogKey, params, 'en-US'));
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
};

export const buildCurrentConnectionSnapshot = (params: {
  activeContext?: { connectionId: string; dbName?: string } | null;
  tabs?: TabData[];
  activeTabId?: string | null;
  connections: SavedConnection[];
  translate?: AIInspectionTranslator;
}) => {
  const {
    activeContext = null,
    tabs = [],
    activeTabId = null,
    connections,
    translate,
  } = params;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const connectionId = String(activeContext?.connectionId || activeTab?.connectionId || '').trim();
  const activeDbName = String(activeContext?.dbName || activeTab?.dbName || '').trim();

  if (!connectionId) {
    return {
      hasActiveConnection: false,
      message: translateInspectionCopy(
        translate,
        'ai_chat.inspection.current_connection.no_active',
        'No active connection is currently selected',
      ),
    };
  }

  const connection = connections.find((item) => item.id === connectionId);
  if (!connection) {
    return {
      hasActiveConnection: false,
      connectionId,
      message: translateInspectionCopy(
        translate,
        'ai_chat.inspection.current_connection.cache_missing',
        'The current active connection does not exist in the local cache',
      ),
    };
  }

  const config = connection.config || {};
  const ssh = config.useSSH ? config.ssh : undefined;
  const proxy = config.useProxy ? config.proxy : undefined;
  const httpTunnel = config.useHttpTunnel ? config.httpTunnel : undefined;
  const configuredHosts = Array.isArray(config.hosts)
    ? config.hosts.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    hasActiveConnection: true,
    connectionId: connection.id,
    connectionName: connection.name,
    connectionType: config.type || '',
    host: config.host || '',
    port: typeof config.port === 'number' ? config.port : null,
    user: config.user || '',
    activeDbName: activeDbName || config.database || '',
    configuredDatabase: config.database || '',
    driver: config.driver || '',
    topology: config.topology || 'single',
    hosts: configuredHosts,
    useSSL: config.useSSL === true,
    sslMode: config.sslMode || '',
    useSSH: config.useSSH === true,
    sshHost: ssh?.host || '',
    sshPort: typeof ssh?.port === 'number' ? ssh.port : null,
    sshUser: ssh?.user || '',
    useProxy: config.useProxy === true,
    proxyType: proxy?.type || '',
    proxyHost: proxy?.host || '',
    proxyPort: typeof proxy?.port === 'number' ? proxy.port : null,
    useHttpTunnel: config.useHttpTunnel === true,
    httpTunnelHost: httpTunnel?.host || '',
    httpTunnelPort: typeof httpTunnel?.port === 'number' ? httpTunnel.port : null,
    hasURI: Boolean(String(config.uri || '').trim()),
    hasDSN: Boolean(String(config.dsn || '').trim()),
    hasConnectionParams: Boolean(String(config.connectionParams || '').trim()),
    clickHouseProtocol: config.clickHouseProtocol || '',
    oceanBaseProtocol: config.oceanBaseProtocol || '',
    replicaSet: config.replicaSet || '',
    authSource: config.authSource || '',
    readPreference: config.readPreference || '',
    mongoSrv: config.mongoSrv === true,
    redisDB: typeof config.redisDB === 'number' ? config.redisDB : null,
    databaseVersion: peekDatabaseServerVersion(connectionId),
    readOnly: activeTab?.readOnly === true || config.jvm?.readOnly === true,
    activeTabId: activeTab?.id || '',
    activeTabType: activeTab?.type || '',
    activeTableName: activeTab?.tableName || '',
  };
};
