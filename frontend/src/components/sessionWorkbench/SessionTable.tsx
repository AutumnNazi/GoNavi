import { Button, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useI18n } from '../../i18n/provider';
import {
  actionLabelKey,
  availableSessionActions,
  displaySessionValue,
  formatSessionDuration,
  type DatabaseSession,
  type SessionAction,
  type SessionCapability,
} from './sessionWorkbenchModel';

export interface SessionTableProps {
  sessions: DatabaseSession[];
  capability: SessionCapability;
  connectionName: string;
  databaseName: string;
  loading: boolean;
  onAction: (session: DatabaseSession, action: SessionAction) => void;
}

export default function SessionTable({
  sessions,
  capability,
  connectionName,
  databaseName,
  loading,
  onAction,
}: SessionTableProps) {
  const { t } = useI18n();
  const hasSessionId = sessions.some((session) => Boolean(session.sessionId));
  const hasQueryId = sessions.some((session) => Boolean(session.queryId));
  const columns: ColumnsType<DatabaseSession> = [
    {
      title: t('session_workbench.table.connection'),
      key: 'connection',
      width: 160,
      render: () => connectionName || t('session_workbench.value.empty'),
    },
    {
      title: t('session_workbench.table.database'),
      dataIndex: 'databaseOrTenant',
      key: 'databaseOrTenant',
      width: 150,
      render: (value: string) => displaySessionValue(value || databaseName, t),
    },
    ...(hasSessionId ? [{
      title: t('session_workbench.table.session_id'),
      dataIndex: 'sessionId',
      key: 'sessionId',
      width: 130,
      render: (value: string) => displaySessionValue(value, t),
    }] : []),
    ...(hasQueryId ? [{
      title: t('session_workbench.table.query_id'),
      dataIndex: 'queryId',
      key: 'queryId',
      width: 190,
      render: (value: string) => displaySessionValue(value, t),
    }] : []),
    {
      title: t('session_workbench.table.statement'),
      dataIndex: 'statement',
      key: 'statement',
      ellipsis: true,
      render: (value: string) => {
        const shown = displaySessionValue(value, t);
        return <Tooltip title={value || undefined}><span>{shown}</span></Tooltip>;
      },
    },
    {
      title: t('session_workbench.table.state'),
      dataIndex: 'state',
      key: 'state',
      width: 120,
      render: (value: string) => value
        ? <Tag>{value}</Tag>
        : t('session_workbench.value.empty'),
    },
    {
      title: t('session_workbench.table.duration'),
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 110,
      render: (value: number | undefined) => formatSessionDuration(value, t),
    },
    {
      title: t('session_workbench.table.user'),
      dataIndex: 'user',
      key: 'user',
      width: 130,
      render: (value: string) => displaySessionValue(value, t),
    },
    {
      title: t('session_workbench.table.actions'),
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_value: unknown, session: DatabaseSession) => (
        <Space wrap size={4}>
          {(() => {
            const actions = availableSessionActions(capability, session);
            if (actions.length > 1) {
              // Dual-capability engines must enter the dedicated action
              // chooser instead of presenting two immediate-looking danger
              // buttons in the row.
              return (
                <Button
                  size="small"
                  onClick={() => onAction(session, actions[0])}
                  title={t('session_workbench.action.choose')}
                >
                  {t('session_workbench.action.choose')}
                </Button>
              );
            }
            if (actions.length === 0) {
              return <Typography.Text type="secondary">{t('session_workbench.value.empty')}</Typography.Text>;
            }
            return actions.map((action) => (
              <Button
                key={action}
                size="small"
                danger={action === 'terminateSession'}
                onClick={() => onAction(session, action)}
                title={t(actionLabelKey(action))}
              >
                {t(actionLabelKey(action))}
              </Button>
            ));
          })()}
        </Space>
      ),
    },
  ];

  return (
    <Table<DatabaseSession>
      className="gn-session-workbench-table"
      rowKey="key"
      loading={loading}
      columns={columns}
      dataSource={sessions}
      pagination={{ pageSize: 50, showSizeChanger: true }}
      scroll={{ x: 1240 }}
      size="small"
      locale={{ emptyText: <Typography.Text type="secondary">{t('session_workbench.empty.no_sessions')}</Typography.Text> }}
    />
  );
}
