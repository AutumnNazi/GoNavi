import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import SidebarConnectionRail from './SidebarConnectionRail';

vi.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Form: {},
}));

vi.mock('@ant-design/icons', () => {
  const Icon = () => <span data-icon="true" />;
  return {
    AimOutlined: Icon,
    DatabaseOutlined: Icon,
    FileAddOutlined: Icon,
    FolderOpenOutlined: Icon,
    ImportOutlined: Icon,
    RobotOutlined: Icon,
    SettingOutlined: Icon,
    TableOutlined: Icon,
  };
});

describe('SidebarConnectionRail', () => {
  it('opens the data import workbench from its dedicated rail action', () => {
    const openDataImport = vi.fn();
    const noop = vi.fn();
    const renderer = create(
      <SidebarConnectionRail
        labels={{
          railSystemActions: 'System actions',
          railObjectActions: 'Object actions',
          newGroup: 'New group',
          batchTables: 'Batch tables',
          batchDatabases: 'Batch databases',
          dataImport: 'Data import',
          openExternalSqlFile: 'Open SQL file',
          locateCurrentTable: 'Locate table',
          locateCurrentTableUnavailable: 'No table',
          aiAssistant: 'AI assistant',
          settings: 'Settings',
        }}
        handlers={{
          openCreateTagModal: noop,
          openBatchTableExport: noop,
          openBatchDatabaseExport: noop,
          openDataImport,
          openExternalSqlFile: noop,
          locateActiveTab: noop,
          toggleAI: noop,
          openSettings: noop,
        }}
        canLocateActiveTab
      />,
    );

    const action = renderer.root.findByProps({
      'data-sidebar-data-import-action': 'true',
    });
    action.props.onClick();

    expect(action.props['aria-label']).toBe('Data import');
    expect(openDataImport).toHaveBeenCalledTimes(1);
  });
});
