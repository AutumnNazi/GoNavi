import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import SqlAuditDetailDrawer from './SqlAuditDetailDrawer';
import { normalizeSQLAuditEvent } from './sqlAuditModel';

vi.mock('../../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en-US' }) }));
vi.mock('@ant-design/icons', () => ({ CopyOutlined: () => null, EditOutlined: () => null }));
vi.mock('antd', () => {
  const Control = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Alert: Control, Button: Control, Drawer: Control, Empty: Control, Pagination: Control,
    Space: Control, Spin: Control, Tag: Control,
    Descriptions: Object.assign(Control, { Item: Control }),
    Typography: { Paragraph: Control, Text: Control, Title: Control },
    message: { success: vi.fn(), error: vi.fn() }, theme: { useToken: () => ({ token: {} }) },
  };
});

describe('MCP request execution details', () => {
  it('loads all statements by exact request ID and keeps pagination scoped to the request', async () => {
    const event = normalizeSQLAuditEvent({ id: 'summary', source: 'mcp', mcpRequestId: 'request-1', mcpClient: 'sha256:client', transactionId: 'tx-ignored', sqlText: 'SELECT ?; SELECT ?' });
    const getEvents = vi.fn().mockResolvedValue({ success: true, data: { items: [event], total: 60 } });
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<SqlAuditDetailDrawer event={event} open onClose={vi.fn()} backend={{ GetSQLAuditEvents: getEvents }} />); });
      expect(getEvents).toHaveBeenLastCalledWith({ mcpRequestId: 'request-1', page: 1, pageSize: 50 });
      const pagination = renderer.root.findAll((node) => node.props['aria-label'] === 'sql_audit.detail.timeline_pagination_aria_label')[0];
      await act(async () => pagination.props.onChange(2));
      expect(getEvents).toHaveBeenLastCalledWith({ mcpRequestId: 'request-1', page: 2, pageSize: 50 });
      expect(JSON.stringify(renderer.toJSON())).toContain('sha256:client');
    } finally {
      if (renderer) act(() => renderer.unmount());
    }
  });
});
