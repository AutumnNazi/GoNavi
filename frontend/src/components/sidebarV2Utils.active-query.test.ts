import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveV2SelectedDatabaseName } from './sidebarV2Utils';

describe('resolveV2SelectedDatabaseName', () => {
  it('keeps a selected database only when it belongs to the active connection', () => {
    expect(resolveV2SelectedDatabaseName({
      activeConnectionId: 'conn-local',
      activeContextConnectionId: 'conn-local',
      activeContextDbName: 'reporting',
    })).toBe('reporting');

    expect(resolveV2SelectedDatabaseName({
      activeConnectionId: 'conn-local',
      activeContextConnectionId: 'conn-other',
      activeContextDbName: 'analytics',
    })).toBe('');
  });

  it('does not bind a connection-level query to an empty selected database', () => {
    expect(resolveV2SelectedDatabaseName({
      activeConnectionId: 'conn-local',
      activeContextConnectionId: 'conn-local',
      activeContextDbName: '   ',
    })).toBe('');
  });

  it('uses the selected-database resolver before falling back to the connection action', () => {
    const sidebarSource = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    const databaseNodeStart = sidebarSource.indexOf('const getDatabaseNodeRef = (connRef: any, dbName: string) => {');
    const databaseNodeEnd = sidebarSource.indexOf('const extractObjectName =', databaseNodeStart);
    const headerStart = sidebarSource.indexOf('<div className="gn-v2-active-connection-actions">');
    const headerEnd = sidebarSource.indexOf('<Tooltip title={v2ConnectionActionsLabel}>', headerStart);
    const databaseNodeSource = sidebarSource.slice(databaseNodeStart, databaseNodeEnd);
    const headerSource = sidebarSource.slice(headerStart, headerEnd);

    expect(databaseNodeSource).toContain('title: dbName,');
    expect(headerSource).toContain('const selectedDatabase = resolveV2SelectedDatabaseName({');
    expect(headerSource).toContain("handleV2DatabaseContextMenuAction(getDatabaseNodeRef(activeConnection, selectedDatabase), 'new-query');");
    expect(headerSource).toContain("handleV2ConnectionContextMenuAction(getConnectionNodeForAction(activeConnection), 'new-query');");
  });
});
