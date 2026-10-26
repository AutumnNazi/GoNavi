import type { Handler } from './protocol.js';
import type { JSONValue } from './types.js';
import type { DataSourceOperations, DataSourceRequest } from './datasourceTypes.js';
import { dataSourceArray, dataSourceExec, dataSourceJSON, dataSourceQuery, dataSourceTransaction, datasourceError, decodeDataSourceRequest } from './datasourceValidation.js';

interface Session { ready: boolean; closed: boolean; remembered: boolean; calls: Set<AbortController> }
const cancelled = () => datasourceError('datasource request cancelled', -32800);

/** One contribution/process. Provider resources belong to callbacks, never to the host SDK.
 * Keeps 128 active sessions and 4096 recent settled tombstones; closed in-flight records stay fenced.
 * Callbacks must yield and honor signals. This is not a SQL engine, write API or sandbox. */
export class DataSourceDispatcher {
  private readonly sessions = new Map<string, Session>();
  private readonly tombstones: string[] = [];
  private active = 0;
  private connecting = 0;
  private stopped = false;
  private readonly operations: DataSourceOperations;
  constructor(operations: DataSourceOperations) { this.operations = { ...operations }; }

  readonly handle: Handler = async (value, signal) => {
    if (signal.aborted) throw cancelled();
    const request = decodeDataSourceRequest(value);
    if (request.operation === 'connect') return this.connect(request, signal);
    if (request.operation === 'close') return this.closeSession(request, signal);
    const session = this.sessions.get(request.sessionId);
    if (this.stopped || !session?.ready || session.closed) throw datasourceError('datasource session unavailable');
    const call = this.beginCall(session, signal);
    try {
      const result = await this.dispatch(request, call.controller.signal);
      if (call.controller.signal.aborted || session.closed || this.stopped || this.sessions.get(request.sessionId) !== session) throw cancelled();
      return dataSourceJSON(result);
    } finally { call.release(); this.remember(request.sessionId, session); }
  };

  private beginCall(session: Session, signal: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    session.calls.add(controller);
    return { controller, release: () => { signal.removeEventListener('abort', abort); session.calls.delete(controller); } };
  }

  private async connect(request: DataSourceRequest, signal: AbortSignal): Promise<JSONValue> {
    if (!this.operations.connect || !this.operations.close) throw datasourceError('unsupported datasource operation', -32601);
    if (this.stopped || this.sessions.has(request.sessionId)) throw datasourceError('datasource session unavailable');
    if (this.active >= 128 || this.connecting >= 128) throw datasourceError('datasource session limit exceeded');
    const session: Session = { ready: false, closed: false, remembered: false, calls: new Set() };
    this.sessions.set(request.sessionId, session); this.active++; this.connecting++;
    const call = this.beginCall(session, signal);
    let failure: unknown;
    let failed = false;
    try { await this.operations.connect(request, call.controller.signal); }
    catch (error: unknown) { failed = true; failure = error; }
    if (call.controller.signal.aborted || session.closed || this.stopped || this.sessions.get(request.sessionId) !== session) { failed = true; failure = cancelled(); }
    call.release(); this.connecting--;
    if (!failed) { session.ready = true; return { ok: true }; }
    if (!session.closed) { session.closed = true; this.active--; }
    this.remember(request.sessionId, session);
    const cleanup = new AbortController();
    const timer = setTimeout(() => cleanup.abort(), 2000);
    try { await this.operations.close({ protocolVersion: 1, operation: 'close', sessionId: request.sessionId }, cleanup.signal); }
    finally { clearTimeout(timer); }
    throw failure;
  }

  private async closeSession(request: DataSourceRequest, signal: AbortSignal): Promise<JSONValue> {
    let session = this.sessions.get(request.sessionId);
    if (session?.closed) return { ok: true };
    if (session) this.active--;
    else { session = { ready: false, closed: false, remembered: false, calls: new Set() }; this.sessions.set(request.sessionId, session); }
    session.closed = true;
    for (const controller of session.calls) controller.abort();
    this.remember(request.sessionId, session);
    if (!this.operations.close) throw datasourceError('unsupported datasource operation', -32601);
    await this.operations.close(request, signal);
    return { ok: true };
  }

  private remember(id: string, session: Session): void {
    if (!session.closed || session.calls.size > 0 || session.remembered) return;
    session.remembered = true; this.tombstones.push(id);
    while (this.tombstones.length > 4096) {
      const oldest = this.tombstones.shift();
      if (oldest !== undefined) {
        const record = this.sessions.get(oldest);
        if (record?.closed && record.calls.size === 0) this.sessions.delete(oldest);
      }
    }
  }

  /** Call when the protocol closes. Provider cleanup remains cooperative and must be idempotent. */
  async close(signal: AbortSignal): Promise<void> {
    this.stopped = true;
    const ids = [...this.sessions].filter(([, session]) => !session.closed).map(([id]) => id);
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (!session) continue;
      session.closed = true;
      for (const controller of session.calls) controller.abort();
      this.remember(id, session);
    }
    this.active = 0;
    const failures: unknown[] = [];
    for (const id of ids) {
      try {
        if (!this.operations.close) throw datasourceError('unsupported datasource operation', -32601);
        await this.operations.close({ protocolVersion: 1, operation: 'close', sessionId: id }, signal);
      } catch (error: unknown) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'datasource cleanup failed');
  }

  private async dispatch(request: DataSourceRequest, signal: AbortSignal): Promise<unknown> {
    const operations = this.operations;
    switch (request.operation) {
      case 'ping': if (operations.ping) { await operations.ping(request, signal); return { ok: true }; } break;
      case 'query': if (operations.query) return dataSourceQuery(await operations.query(request, signal)); break;
      case 'databases': if (operations.databases) return dataSourceArray('names', await operations.databases(request, signal)); break;
      case 'tables': if (operations.tables) return dataSourceArray('names', await operations.tables(request, signal)); break;
      case 'createStatement': if (operations.createStatement) {
        const statement = await operations.createStatement(request, signal);
        if (typeof statement !== 'string' || statement.length === 0) throw datasourceError('invalid datasource statement result', -32603);
        return { statement };
      } break;
      case 'columns': if (operations.columns) return dataSourceArray('columns', await operations.columns(request, signal)); break;
      case 'allColumns': if (operations.allColumns) return dataSourceArray('allColumns', await operations.allColumns(request, signal)); break;
      case 'indexes': if (operations.indexes) return dataSourceArray('indexes', await operations.indexes(request, signal)); break;
      case 'foreignKeys': if (operations.foreignKeys) return dataSourceArray('foreignKeys', await operations.foreignKeys(request, signal)); break;
      case 'triggers': if (operations.triggers) return dataSourceArray('triggers', await operations.triggers(request, signal)); break;
      case 'exec': if (operations.exec) return dataSourceExec(await operations.exec(request, signal)); break;
      case 'begin': if (operations.begin) return dataSourceTransaction(await operations.begin(request, signal)); break;
      case 'commit': if (operations.commit) { await operations.commit(request, signal); return { ok: true }; } break;
      case 'rollback': if (operations.rollback) { await operations.rollback(request, signal); return { ok: true }; } break;
    }
    throw datasourceError('unsupported datasource operation', -32601);
  }
}
