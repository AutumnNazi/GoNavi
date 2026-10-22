import { beforeEach, describe, expect, it } from 'vitest';
import { replacePluginDataSources } from './snapshot';
import { sanitizeConnections } from '../../store/storeConnectionConfig';
import { pluginDataSourceInitialValues, pluginDataSourceNewValues, buildPluginDataSourceConfig, hasUnsupportedPluginTransport } from '../../components/connectionModal/pluginDataSourceForm';
const type = 'plugin:demo.source:reader:mysql';
const writableType = 'plugin:demo.source:writer:mysql';
const full = { restrictDataEdit: true, restrictStructureEdit: true, restrictScriptExecution: true, restrictDataImport: true };
const saved = (name: string, extra: Record<string, unknown> = {}) => sanitizeConnections([{ id: 'saved', name: 'Plugin', config: { type: name, host: '', port: 0, user: ' kept ', password: ' secret ', readOnly: false, protection: { restrictDataImport: false }, ...extra } }])[0];
describe('saved plugin connection persistence', () => {
  beforeEach(() => replacePluginDataSources({ items: [
    { type, pluginId: 'demo.source', id: 'reader', name: 'Reader', dialect: 'mysql', defaultPort: 0, version: '1', generation: 1, available: true, connectable: true, state: 'running', readOnly: true },
    { type: writableType, pluginId: 'demo.source', id: 'writer', name: 'Writer', dialect: 'mysql', defaultPort: 0, version: '1', generation: 1, available: true, connectable: true, state: 'running', readOnly: false },
  ] }));
  it.each([type, 'plugin:missing.source:reader:postgres', 'plugin', 'Plugin:demo.source:reader:mysql', 'plugin:iris.vendor::mysql', 'plugin:demo.source:reader:unknown'])('keeps identity and forced protection without builtin fallback: %s', (identity) => {
    const connection = saved(identity);
    expect(connection.config.type).toBe(identity); expect(connection.config.host).toBe(''); expect(connection.config.port).toBe(0);
    expect(connection.config.user).toBe(' kept '); expect(connection.config.password).toBe(' secret ');
    expect(connection.config.readOnly).toBe(true); expect(connection.config.protection).toEqual(full);
  });
  it('retains unsupported TLS/proxy flags and blocks saving until explicit clear', () => {
    const connection = saved(type, { useSSL: true, sslMode: 'required', sslCAPath: '/ca', useProxy: true, useHttpTunnel: true });
    expect(connection.config.useSSL).toBe(true); expect(connection.config.sslMode).toBe('required'); expect(connection.config.sslCAPath).toBe('/ca');
    expect(connection.config.useProxy).toBe(true); expect(connection.config.useHttpTunnel).toBe(true);
    const values = { type, ...pluginDataSourceInitialValues(connection.config) };
    expect(hasUnsupportedPluginTransport(values)).toBe(true); expect(() => buildPluginDataSourceConfig(values, true, connection)).toThrow();
  });
  it.each([{ sslMode: 'preferred' }, { uri: 'mysql://other' }, { dsn: 'private' }, { driver: 'mysql' }, { driverVariant: 'legacy' }, { hosts: ['other:1'] }, { topology: 'cluster' }])('rejects unsupported existing options instead of dropping them: %j', (patch) => {
    const connection = saved(type, patch);
    expect(() => buildPluginDataSourceConfig({ type, ...pluginDataSourceInitialValues(connection.config) }, true, connection)).toThrow();
  });
  it('creates direct readonly configs without inherited passwords or builtin defaults', () => {
    const values = pluginDataSourceNewValues(type); const result = buildPluginDataSourceConfig(values, true);
    expect(result.type).toBe(type); expect(result.sslMode).toBe('disable'); expect(result.host).toBe(''); expect(result.port).toBe(0);
    expect(result.password).toBe(''); expect(result.protection).toEqual(full); expect(result).not.toHaveProperty('useSSH');
    const overridden = buildPluginDataSourceConfig({ ...values, readOnly: false, restrictDataEdit: false, restrictDataImport: false }, true);
    expect(overridden.readOnly).toBe(true); expect(overridden.protection).toEqual(full);
  });
  it('starts a new writable source fully protected until one category is enabled', () => {
    const values = pluginDataSourceNewValues(writableType);
    expect(values).toMatchObject(full);
    const closed = buildPluginDataSourceConfig(values, true);
    expect(closed.readOnly).toBe(true); expect(closed.pluginWritable).toBe(true); expect(closed.protection).toEqual(full);
    const opened = buildPluginDataSourceConfig({ ...values, restrictDataEdit: false }, true);
    expect(opened.readOnly).toBe(false); expect(opened.pluginWritable).toBe(true);
    expect(opened.protection).toEqual({ ...full, restrictDataEdit: false });
  });
});
