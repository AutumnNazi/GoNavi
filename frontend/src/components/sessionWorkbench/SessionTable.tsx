import { Button, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useI18n } from '../../i18n/provider';
import {
  actionLabelKey,
  availableSessionActions,
  displaySessionValue,
  formatSessionDuration,
  sessionStateTone,
  type DatabaseSession,
  type SessionAction,
  type SessionCapability,
} from './sessionWorkbenchModel';

const actionButtonClass = (kind: 'choose' | 'cancel' | 'terminate'): string => (
  `gn-session-action-btn is-${kind}`
);

function SessionActions({
  session,
  capability,
  onAction,
  label,
}: {
  session: DatabaseSession;
  capability: SessionCapability;
  onAction: (session: DatabaseSession, action: SessionAction) => void;
  label: (key: string) => string;
}) {
  const actions = availableSessionActions(capability, session);
  if (actions.length > 1) {
    // Dual-capability engines must enter the dedicated action chooser
    // instead of presenting two immediate-looking danger buttons.
    return (
      <Button
        size="small"
        className={actionButtonClass('choose')}
        onClick={() => onAction(session, actions[0])}
        title={label('session_workbench.action.choose')}
      >
        {label('session_workbench.action.choose')}
      </Button>
    );
  }
  if (actions.length === 0) {
    return <Typography.Text type="secondary">{label('session_workbench.value.empty')}</Typography.Text>;
  }
  return (
    <>
      {actions.map((action) => (
        <Button
          key={action}
          size="small"
          className={actionButtonClass(action === 'terminateSession' ? 'terminate' : 'cancel')}
          onClick={() => onAction(session, action)}
          title={label(actionLabelKey(action))}
        >
          {label(actionLabelKey(action))}
        </Button>
      ))}
    </>
  );
}

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
      width: 240,
      render: (value: string) => {
        const shown = displaySessionValue(value, t);
        return (
          <Tooltip title={value || undefined}>
            <span className="gn-session-statement-cell">{shown}</span>
          </Tooltip>
        );
      },
    },
    {
      title: t('session_workbench.table.state'),
      dataIndex: 'state',
      key: 'state',
      width: 120,
      render: (value: string) => value
        ? <Tag className={`gn-session-state-tag is-${sessionStateTone(value)}`}>{value}</Tag>
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
      width: 168,
      render: (_value: unknown, session: DatabaseSession) => (
        <Space wrap size={4}>
          <SessionActions
            session={session}
            capability={capability}
            onAction={onAction}
            label={t}
          />
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
      tableLayout="fixed"
      size="small"
      locale={{ emptyText: <Typography.Text type="secondary">{t('session_workbench.empty.no_sessions')}</Typography.Text> }}
    />
  );
}
