import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionConfig } from '../../types';
import { replacePluginDataSources } from './snapshot';
import { getDataSourceCapabilities } from '../../utils/dataSourceCapabilities';
import { resolveConnectionProtectionConfig, findConnectionMutatingStatements, isConnectionDataImportRestricted, supportsConnectionKeepAliveSQL } from '../../utils/connectionReadOnly';
import { getDataSourceSpec, listDataSourceSpecs, registryAllowsImport } from '../../utils/dataSourceRegistry';
import { resolveRegistryQuoting } from '../../utils/dataSourceRegistry/sqlBehavior';
import { getDataGridSaveCapability } from '../../components/dataGrid/dataGridSaveCapability';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
const full = { restrictDataEdit: true, restrictStructureEdit: true, restrictScriptExecution: true, restrictDataImport: true };
const config = (type: string): ConnectionConfig => ({ type, host: '', port: 0, user: '', readOnly: false, protection: { restrictDataEdit: false } });
afterEach(() => replacePluginDataSources({ items: [] }));
describe('plugin datasource safety gates', () => {
  it.each(['mysql', 'postgres', 'sqlite'])('permits only running %s query/metadata without mutating builtins', (dialect) => {
    const builtin = listDataSourceSpecs(); const before = JSON.stringify(builtin);
    const type = 'plugin:demo.source:reader:' + dialect;
    replacePluginDataSources({ items: [{ type, pluginId: 'demo.source', id: 'reader', name: 'Reader', dialect,
      version: '1', generation: 1, defaultPort: 0, available: true, connectable: true, state: 'running', readOnly: true }] });
    const caps = getDataSourceCapabilities(config(type));
    expect(caps.query.supported).toBe(true); expect(caps.metadata.supported).toBe(true); expect(caps.transaction.supported).toBe(false);
    expect(caps.forceReadOnlyStructureDesigner).toBe(true); expect(caps.forceReadOnlyQueryResult).toBe(true); expect(caps.supportsCreateDatabase).toBe(false);
    expect(caps.contract.ui.forceReadOnlyQueryResult).toBe(true); expect(caps.contract.ui.forceReadOnlyStructureDesigner).toBe(true);
    expect(getDataSourceSpec(type)?.wire).toBe('plugin'); expect(getDataSourceSpec(type)?.type).toBe(type);
    expect(resolveRegistryQuoting(type)).toBe(dialect === 'mysql' ? 'backtick' : dialect === 'postgres' ? 'pg' : 'double');
    expect(listDataSourceSpecs()).toBe(builtin); expect(JSON.stringify(builtin)).toBe(before);
    expect(findConnectionMutatingStatements(config(type), 'SELECT 1')).toHaveLength(0);
    expect(buildRpcConnectionConfig(config(type)).readOnly).toBe(true);
    expect(buildRpcConnectionConfig(config(type)).protection).toMatchObject(full);
    for (const sql of ['DELETE FROM records', 'UPDATE records SET n=1', 'CREATE TABLE x (id int)', 'COMMIT']) expect(findConnectionMutatingStatements(config(type), sql)).not.toHaveLength(0);
  });
  it.each(['plugin:missing.source:reader:mysql', 'plugin:missing.source:reader:postgres', 'plugin:missing.source:reader:sqlite',
    'plugin', 'Plugin:missing.source:reader:mysql', 'plugin:missing.source::mysql', 'plugin:missing.source:reader:unknown', 'plugin:missing.source:reader:mysql:extra'])('keeps all write/import gates locked for missing or malformed %s', (type) => {
    const value = config(type); const caps = getDataSourceCapabilities(value);
    expect(caps.query.supported).toBe(false); expect(caps.metadata.supported).toBe(false); expect(caps.transaction.supported).toBe(false);
    expect(caps.forceReadOnlyStructureDesigner).toBe(true); expect(caps.forceReadOnlyQueryResult).toBe(true);
    expect(caps.contract.ui.forceReadOnlyQueryResult).toBe(true); expect(caps.contract.ui.forceReadOnlyStructureDesigner).toBe(true);
    expect(resolveConnectionProtectionConfig(value)).toEqual(full); expect(buildRpcConnectionConfig(value).protection).toMatchObject(full);
    expect(buildRpcConnectionConfig(value).readOnly).toBe(true); expect(getDataGridSaveCapability(value).supported).toBe(false);
    expect(isConnectionDataImportRestricted(value)).toBe(true); expect(registryAllowsImport(type, 'table')).toBe(false); expect(registryAllowsImport(type, 'sqlFile')).toBe(false);
    expect(supportsConnectionKeepAliveSQL(value)).toBe(false);
  });
  it('keeps a writable source closed until the connection opts in', () => {
    const type = 'plugin:demo.source:writer:sqlite';
    replacePluginDataSources({ items: [{ type, pluginId: 'demo.source', id: 'writer', name: 'Writer', dialect: 'sqlite',
      version: '1', generation: 1, defaultPort: 0, available: true, connectable: true, state: 'running', readOnly: false }] });
    const closed = getDataSourceCapabilities(config(type));
    expect(closed.transaction.supported).toBe(false);
    expect(closed.contract.ui.forceReadOnlyQueryResult).toBe(true);
    expect(closed.contract.ui.forceReadOnlyStructureDesigner).toBe(true);
    const optedIn = getDataSourceCapabilities({ ...config(type), pluginWritable: true });
    expect(optedIn.transaction.supported).toBe(true);
    expect(optedIn.contract.ui.forceReadOnlyQueryResult).toBe(false);
    expect(optedIn.contract.ui.forceReadOnlyStructureDesigner).toBe(false);
    expect(buildRpcConnectionConfig({ ...config(type), pluginWritable: true }).readOnly).toBe(false);
    expect(buildRpcConnectionConfig({ ...config(type), pluginWritable: true }).pluginWritable).toBe(true);
    const readOnly = getDataSourceCapabilities({ ...config(type), pluginWritable: true, readOnly: true });
    expect(readOnly.transaction.supported).toBe(false);
    expect(readOnly.contract.ui.forceReadOnlyQueryResult).toBe(true);
    const forged = { ...config(type), protection: { restrictDataEdit: true } };
    expect(resolveConnectionProtectionConfig(forged)).toEqual(full);
    expect(buildRpcConnectionConfig(forged).readOnly).toBe(true);
    const partial = { ...config(type), pluginWritable: true, protection: { restrictDataEdit: true } };
    expect(resolveConnectionProtectionConfig(partial)).toEqual({
      ...full, restrictStructureEdit: false, restrictScriptExecution: false, restrictDataImport: false,
    });
  });
  it('denies even SELECT classification for malformed reserved identities', () => {
    expect(findConnectionMutatingStatements(config('plugin'), 'SELECT 1')).toHaveLength(1);
  });
  it('does not reuse plugin metadata through custom JDBC driver settings', () => {
    const value = { ...config('custom'), driver: 'plugin:demo.source:reader:mysql' };
    expect(getDataSourceCapabilities(value).query.supported).toBe(false); expect(resolveConnectionProtectionConfig(value)).toEqual(full);
    expect(getDataGridSaveCapability(value).supported).toBe(false);
  });
  it('retains builtin write/import/SQL behavior', () => {
    const value = config('mysql');
    expect(getDataSourceCapabilities(value).query.supported).toBe(true); expect(getDataGridSaveCapability(value).supported).toBe(true);
    expect(registryAllowsImport('mysql', 'table')).toBe(true); expect(resolveConnectionProtectionConfig(value)).not.toEqual(full);
  });
});
