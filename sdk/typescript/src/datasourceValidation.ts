import type { JSONValue } from './types.js';
import type { DataSourceConfig, DataSourceOperation, DataSourceQueryResult, DataSourceRequest } from './datasourceTypes.js';

const operations = new Set<DataSourceOperation>(['connect', 'ping', 'close', 'query', 'databases', 'tables', 'createStatement', 'columns', 'allColumns', 'indexes', 'foreignKeys', 'triggers', 'exec', 'begin', 'commit', 'rollback']);
const writeOperations = new Set<DataSourceOperation>(['exec', 'begin', 'commit', 'rollback', 'query']);
const sessionPattern = /^[A-Za-z0-9_-]{1,128}$/;
const configKeys = new Set(['host', 'port', 'user', 'password', 'database', 'connectionParams']);

export function datasourceError(message: string, code = -32603): Error {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
}

function withinBytes(value: string, limit: number): boolean {
  return new TextEncoder().encode(value).length <= limit;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function decodeDataSourceRequest(value: JSONValue): DataSourceRequest {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024) throw datasourceError('datasource limit exceeded', -32000);
  if (!record(value) || (value.protocolVersion !== 1 && value.protocolVersion !== 2) || typeof value.operation !== 'string' || typeof value.sessionId !== 'string' || !sessionPattern.test(value.sessionId)) {
    throw datasourceError('invalid datasource request', -32600);
  }
  if (!operations.has(value.operation as DataSourceOperation)) throw datasourceError('unsupported datasource operation', -32601);
  for (const item of Object.values(value)) if (item === null) throw datasourceError('invalid datasource request', -32600);
  if (value.protocolVersion === 2) return decodeDataSourceWriteRequest(value);
  const operation = value.operation as DataSourceOperation;
  const sessionId = value.sessionId;
  if (value.transactionId !== undefined) throw datasourceError('invalid datasource request', -32600);
  if (operation === 'connect') {
    if (value.query !== undefined || value.database !== undefined || value.table !== undefined) throw datasourceError('invalid datasource request', -32600);
    return { protocolVersion: 1, operation, sessionId, config: decodeConfig(value.config) };
  }
  if (value.config !== undefined) throw datasourceError('invalid datasource request', -32600);
  if (operation === 'query') {
    if (typeof value.query !== 'string' || value.query.length === 0 || !withinBytes(value.query, 256 * 1024)) throw datasourceError('datasource limit exceeded', -32000);
    return { protocolVersion: 1, operation, sessionId, query: value.query };
  }
  if (value.query !== undefined) throw datasourceError('invalid datasource request', -32600);
  const request: DataSourceRequest = { protocolVersion: 1, operation, sessionId };
  if (typeof value.database === 'string') request.database = value.database;
  if (typeof value.table === 'string') request.table = value.table;
  if ((request.database != null && !withinBytes(request.database, 1024)) || (request.table != null && !withinBytes(request.table, 1024))) throw datasourceError('datasource limit exceeded', -32000);
  return request;
}

function decodeDataSourceWriteRequest(value: Record<string, unknown>): DataSourceRequest {
  const operation = value.operation as DataSourceOperation;
  if (!writeOperations.has(operation) || value.config !== undefined || value.database !== undefined || value.table !== undefined) {
    throw datasourceError(operation === 'exec' || operation === 'begin' || operation === 'commit' || operation === 'rollback' ? 'invalid datasource request' : 'unsupported datasource operation', -32600);
  }
  const transactionId = value.transactionId;
  if (operation === 'begin') {
    if (transactionId !== undefined || value.query !== undefined) throw datasourceError('invalid datasource request', -32600);
    return { protocolVersion: 2, operation, sessionId: value.sessionId as string };
  }
  if (typeof transactionId !== 'string' || !sessionPattern.test(transactionId)) throw datasourceError('invalid datasource request', -32600);
  if (operation === 'query' || operation === 'exec') {
    if (typeof value.query !== 'string' || value.query.length === 0 || !withinBytes(value.query, 256 * 1024)) throw datasourceError('datasource limit exceeded', -32000);
    return { protocolVersion: 2, operation, sessionId: value.sessionId as string, transactionId, query: value.query };
  }
  if (value.query !== undefined) throw datasourceError('invalid datasource request', -32600);
  return { protocolVersion: 2, operation, sessionId: value.sessionId as string, transactionId };
}

function decodeConfig(value: unknown): DataSourceConfig {
  if (!record(value)) throw datasourceError('invalid datasource request', -32600);
  for (const [key, item] of Object.entries(value)) {
    if (!configKeys.has(key) || item === null) throw datasourceError('invalid datasource request', -32600);
  }
  const port = value.port;
  const params = value.connectionParams;
  if (typeof value.host !== 'string' || typeof value.user !== 'string' || typeof value.password !== 'string' || typeof value.database !== 'string'
    || typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535
    || !withinBytes(value.host, 1024) || !withinBytes(value.user, 1024) || !withinBytes(value.password, 8192) || !withinBytes(value.database, 1024)
    || (typeof params === 'string' && !withinBytes(params, 16384))) throw datasourceError('invalid datasource request', -32600);
  if (params !== undefined && typeof params !== 'string') throw datasourceError('invalid datasource request', -32600);
  return { host: value.host, port, user: value.user, password: value.password, database: value.database, connectionParams: typeof params === 'string' ? params : '' };
}

export function dataSourceQuery(result: DataSourceQueryResult): JSONValue {
  if (!result || !Array.isArray(result.fields) || !Array.isArray(result.rows)) throw datasourceError('invalid datasource result');
  if (result.fields.length > 512 || result.rows.length > 10000) throw datasourceError('datasource limit exceeded', -32000);
  const fields = new Set<string>();
  for (const field of result.fields) {
    if (typeof field !== 'string' || field.length === 0 || !withinBytes(field, 1024) || fields.has(field)) throw datasourceError('invalid datasource result');
    fields.add(field);
  }
  const rows = result.rows.map((row) => {
    if (!record(row) || Object.keys(row).length !== fields.size) throw datasourceError('invalid datasource result');
    const encoded: Record<string, JSONValue> = {};
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) throw datasourceError('invalid datasource result');
      encoded[field] = jsonValue(row[field]);
    }
    return encoded;
  });
  return { fields: result.fields, rows };
}

export function dataSourceExec(result: { rowsAffected: number }): JSONValue {
  if (!result || !Number.isSafeInteger(result.rowsAffected) || result.rowsAffected < 0) throw datasourceError('invalid datasource result');
  return { ok: true, rowsAffected: result.rowsAffected };
}

export function dataSourceTransaction(id: unknown): JSONValue {
  if (typeof id !== 'string' || !sessionPattern.test(id)) throw datasourceError('invalid datasource result');
  return { ok: true, transactionId: id };
}

export function dataSourceArray(key: string, values: unknown): JSONValue {
  if (!Array.isArray(values)) throw datasourceError('array is required');
  if (values.length > 10000) throw datasourceError('datasource limit exceeded', -32000);
  return { [key]: values.map((value) => jsonValue(value)) };
}

export function dataSourceJSON(value: unknown): JSONValue {
  const encoded = jsonValue(value);
  if (new TextEncoder().encode(JSON.stringify(encoded)).length > 1024 * 1024) throw datasourceError('datasource limit exceeded', -32000);
  return encoded;
}

function jsonValue(value: unknown): JSONValue {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw datasourceError('invalid datasource result');
    return value;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item));
  if (record(value)) {
    const encoded: Record<string, JSONValue> = {};
    for (const [key, item] of Object.entries(value)) encoded[key] = jsonValue(item);
    return encoded;
  }
  throw datasourceError('invalid datasource result');
}

const dataSourceID = /^[a-z][a-z0-9_.-]{0,63}$/;
export function validateDataSource(source: { id: string; name: string; dialect: string; readOnly: boolean; defaultPort?: number }): void {
  if (typeof source.readOnly !== 'boolean') throw new Error('data source must declare readOnly explicitly');
  if (source.dialect !== 'mysql' && source.dialect !== 'postgres' && source.dialect !== 'sqlite') throw new Error('unsupported data source dialect');
  const port = source.defaultPort;
  if (port != null && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('invalid data source port');
  if (!dataSourceID.test(source.id) || source.name.trim() === '' || new TextEncoder().encode(source.name).length > 256 || source.name.includes('\u0000')) throw new Error('invalid data source identity');
}

export function validateDataSourceCommand(source: { id: string; name: string; dialect: string; readOnly: boolean; command: string; defaultPort?: number }, command: { id: string; effect?: string }): void {
  validateDataSource(source);
  if (!source.command || source.command !== command.id) throw new Error('data source command mismatch');
  if (source.readOnly && command.effect != null && command.effect !== '' && command.effect !== 'read' && command.effect !== 'unknown') throw new Error('read-only data source command effect must be read or unknown');
}
