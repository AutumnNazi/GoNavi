import { describe, expect, it } from 'vitest';
import {
  buildSQLAuditFilterPayload,
  DEFAULT_SQL_AUDIT_FILTER,
  getSQLAuditEnumLabelKey,
  getSQLAuditEventPreview,
  getSQLAuditPrimaryRowCount,
  getSQLAuditHealthPhase,
  normalizeSQLAuditEvent,
  normalizeSQLAuditHealth,
  normalizeSQLAuditPage,
  normalizeSQLAuditSettings,
  sortSQLAuditTimeline,
} from './sqlAuditModel';

describe('sqlAuditModel', () => {
  it('normalizes audit events without inventing raw SQL or unsupported boundary modes', () => {
    const event = normalizeSQLAuditEvent({
      id: 'event-1',
      sequence: '12',
      timestamp: 1720000000000,
      eventType: 'transaction_statement',
      status: 'error',
      boundaryMode: 'untrusted-mode',
      sqlText: 'UPDATE users SET token = ?',
      sqlRedacted: true,
      rowsAffected: '2',
      error: 'permission denied',
    });

    expect(event).toMatchObject({
      id: 'event-1',
      sequence: 12,
      eventType: 'transaction_statement',
      status: 'error',
      boundaryMode: 'unknown',
      sqlText: 'UPDATE users SET token = ?',
      sqlRedacted: true,
      rowsAffected: 2,
      error: 'permission denied',
    });
  });

  it('normalizes paged results and explicit summary field names', () => {
    const page = normalizeSQLAuditPage({
      items: [{ id: 'event-1', sqlText: 'SELECT ?' }],
      total: 40,
      page: 2,
      pageSize: 25,
      summary: {
        totalEvents: 40,
        successCount: 35,
        errorCount: 4,
        transactionCount: 8,
        cancelledCount: 1,
      },
    }, { page: 1, pageSize: 50 });

    expect(page).toMatchObject({
      total: 40,
      page: 2,
      pageSize: 25,
      summary: {
        totalEvents: 40,
        successCount: 35,
        errorCount: 4,
        transactionCount: 8,
        cancelledCount: 1,
      },
    });
    expect(page.items[0].id).toBe('event-1');
  });

  it('allows only redacted or metadata capture settings', () => {
    expect(normalizeSQLAuditSettings({ captureMode: 'metadata' }).captureMode).toBe('metadata');
    expect(normalizeSQLAuditSettings({ captureMode: 'full' }).captureMode).toBe('redacted');
    expect(normalizeSQLAuditSettings({ captureMode: 'raw' }).captureMode).toBe('redacted');
  });

  it('normalizes health reports without treating unknown states as healthy', () => {
    expect(normalizeSQLAuditHealth({
      status: 'degraded',
      droppedEvents: '7',
      firstFailureAt: 100,
      lastFailureAt: 200,
      lastSuccessAt: 150,
      lastError: 'disk full',
    })).toEqual({
      status: 'degraded',
      captureEnabled: null,
      captureMode: 'unknown',
      droppedEvents: 7,
      firstFailureAt: 100,
      lastFailureAt: 200,
      lastSuccessAt: 150,
      lastError: 'disk full',
    });
    expect(normalizeSQLAuditHealth({ status: 'future-state' }).status).toBe('unknown');
  });

  it('claims an audit_gap recovery marker only after a post-failure success', () => {
    expect(getSQLAuditHealthPhase(normalizeSQLAuditHealth({
      status: 'healthy', captureEnabled: true, captureMode: 'redacted', droppedEvents: 3, lastFailureAt: 100, lastSuccessAt: 101,
    }))).toBe('recovered');
    expect(getSQLAuditHealthPhase(normalizeSQLAuditHealth({
      status: 'healthy', captureEnabled: true, captureMode: 'redacted', droppedEvents: 3, lastFailureAt: 100, lastSuccessAt: 99,
    }))).toBe('historical_gap');
    expect(getSQLAuditHealthPhase(normalizeSQLAuditHealth({
      status: 'healthy', captureEnabled: true, captureMode: 'redacted', droppedEvents: 0,
    }))).toBe('healthy');
  });

  it('distinguishes disabled capture from a healthy active writer and preserves its mode', () => {
    const disabled = normalizeSQLAuditHealth({
      status: 'healthy', captureEnabled: false, captureMode: 'metadata', droppedEvents: 0,
    });
    expect(disabled.captureEnabled).toBe(false);
    expect(disabled.captureMode).toBe('metadata');
    expect(getSQLAuditHealthPhase(disabled)).toBe('disabled');
    expect(getSQLAuditHealthPhase(normalizeSQLAuditHealth({
      status: 'healthy', captureEnabled: true, captureMode: 'redacted', droppedEvents: 0,
    }))).toBe('healthy');
  });

  it('builds the exact backend filter contract and omits empty values', () => {
    expect(buildSQLAuditFilterPayload({
      ...DEFAULT_SQL_AUDIT_FILTER,
      search: ' orders ',
      connectionId: 'conn-1',
      database: '',
      fromTimestamp: 1000,
      toTimestamp: 2000,
      page: 3,
      pageSize: 25,
    })).toEqual({
      search: 'orders',
      connectionId: 'conn-1',
      fromTimestamp: 1000,
      toTimestamp: 2000,
      page: 3,
      pageSize: 25,
    });
  });

  it('sorts a transaction timeline by chain sequence before timestamp', () => {
    const events = [
      normalizeSQLAuditEvent({ id: 'commit', sequence: 3, timestamp: 100 }),
      normalizeSQLAuditEvent({ id: 'begin', sequence: 1, timestamp: 300 }),
      normalizeSQLAuditEvent({ id: 'statement', sequence: 2, timestamp: 200 }),
    ];

    expect(sortSQLAuditTimeline(events).map((event) => event.id)).toEqual(['begin', 'statement', 'commit']);
  });

  it('keeps table previews single-line and bounded', () => {
    const preview = getSQLAuditEventPreview(normalizeSQLAuditEvent({
      sqlText: 'SELECT  *\nFROM orders WHERE customer_id = ?',
    }), 24);

    expect(preview).toBe('SELECT * FROM orders WH…');
    expect(preview).not.toContain('\n');
  });

  it('shows returned rows for SELECT events and affected rows for mutations', () => {
    expect(getSQLAuditPrimaryRowCount({ rowsAffected: 0, rowsReturned: 7 })).toBe(7);
    expect(getSQLAuditPrimaryRowCount({ rowsAffected: 3, rowsReturned: 0 })).toBe(3);
  });

  it('localizes known enum values while leaving unknown values dynamic', () => {
    expect(getSQLAuditEnumLabelKey('event_type', 'query_statement')).toBe('sql_audit.event_type.query_statement');
    expect(getSQLAuditEnumLabelKey('event_type', 'audit_gap')).toBe('sql_audit.event_type.audit_gap');
    expect(getSQLAuditEnumLabelKey('event_type', 'transaction_commit')).toBe('sql_audit.event_type.transaction_commit');
    expect(getSQLAuditEnumLabelKey('source', 'query_editor')).toBe('sql_audit.source.query_editor');
    expect(getSQLAuditEnumLabelKey('source', 'app_shutdown')).toBe('sql_audit.source.app_shutdown');
    expect(getSQLAuditEnumLabelKey('source', 'table_designer')).toBe('sql_audit.source.table_designer');
    expect(getSQLAuditEnumLabelKey('source', 'data_import')).toBe('sql_audit.source.data_import');
    expect(getSQLAuditEnumLabelKey('source', 'message_publish')).toBe('sql_audit.source.message_publish');
    expect(getSQLAuditEnumLabelKey('source', 'data_grid')).toBeNull();
    expect(getSQLAuditEnumLabelKey('status', 'future-status')).toBeNull();
  });
});
