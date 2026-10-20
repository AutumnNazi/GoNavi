// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Select } from 'antd';
import QueryHistoryToolbar from './QueryHistoryToolbar';
import { useQueryHistoryEvents } from './useQueryHistoryEvents';
import MCPAuditFilters from '../audit/MCPAuditFilters';
import { DEFAULT_SQL_AUDIT_FILTER, buildSQLAuditFilterPayload, normalizeSQLAuditEvent, isSQLAuditEventRestorable } from '../audit/sqlAuditModel';
import type { SQLAuditBackend } from '../audit/sqlAuditRpc';

vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en-US' }) }));
vi.mock('antd', () => {
  const Control = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Button: Control, Select: Control, Input: Control, Segmented: Control, Space: Control, DatePicker: { RangePicker: Control } };
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer?.unmount()); renderer = undefined; });

function History({ backend }: { backend: SQLAuditBackend }) {
  const state = useQueryHistoryEvents({ id: 'history', type: 'sql-audit', title: 'History', connectionId: 'db' }, backend);
  return <QueryHistoryToolbar filter={state.filter} counts={state.counts} connections={[]} hasActiveFilters={state.hasActiveFilters} onFieldChange={state.setFilterField} onReset={state.resetFilters} />;
}

describe('MCP audit history', () => {
  it('keeps the default editor history and requests MCP records only after changing the source', async () => {
    const getEvents = vi.fn().mockResolvedValue({ success: true, data: { items: [], total: 0 } });
    await act(async () => { renderer = create(<History backend={{ GetSQLAuditEvents: getEvents }} />); });
    expect(getEvents.mock.calls[getEvents.mock.calls.length - 1]?.[0]).toMatchObject({ executionHistory: true, connectionId: 'db' });
    expect(getEvents.mock.calls[getEvents.mock.calls.length - 1]?.[0]).not.toHaveProperty('includeMcp');
    const source = () => renderer!.root.findAllByType(Select).find((control) => control.props['aria-label'] === 'sql_audit.filter.source')!;
    await act(async () => { source().props.onChange('mcp'); });
    expect(getEvents.mock.calls[getEvents.mock.calls.length - 1]?.[0]).toMatchObject({ executionHistory: true, includeMcp: true, source: 'mcp', page: 1 });
    await act(async () => { source().props.onChange('all'); });
    expect(getEvents.mock.calls[getEvents.mock.calls.length - 1]?.[0]).toMatchObject({ includeMcp: true });
    expect(getEvents.mock.calls[getEvents.mock.calls.length - 1]?.[0]).not.toHaveProperty('source');
    await act(async () => { source().props.onChange('query_editor'); });
    expect(getEvents.mock.calls[getEvents.mock.calls.length - 1]?.[0]).not.toHaveProperty('includeMcp');
  });

  it('provides an explicit MCP shortcut and serializes the request filter', () => {
    const onChange = vi.fn();
    act(() => { renderer = create(<MCPAuditFilters filter={DEFAULT_SQL_AUDIT_FILTER} onChange={onChange} />); });
    const shortcut = renderer!.root.findAllByType(Button).find((control) => control.props.children === 'sql_audit.mcp.entry')!;
    act(() => shortcut.props.onClick());
    expect(onChange).toHaveBeenCalledWith('source', 'mcp');
    expect(buildSQLAuditFilterPayload({ ...DEFAULT_SQL_AUDIT_FILTER, mcpRequestId: ' request-1 ' })).toMatchObject({ mcpRequestId: 'request-1' });
  });

  it('preserves request metadata and allows restoring captured MCP SQL', () => {
    const event = normalizeSQLAuditEvent({ source: 'mcp', eventType: 'query', sqlText: 'SELECT ?', sqlRedacted: true, mcpRequestId: 'request-1', mcpClient: 'sha256:client' });
    expect(event).toMatchObject({ mcpRequestId: 'request-1', mcpClient: 'sha256:client' });
    expect(isSQLAuditEventRestorable(event)).toBe(true);
    expect(isSQLAuditEventRestorable({ ...event, sqlText: '' })).toBe(false);
  });
});
