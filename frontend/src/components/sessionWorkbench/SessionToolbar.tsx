import { DatabaseOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Typography } from 'antd';
import type { SavedConnection } from '../../types';
import { useI18n } from '../../i18n/provider';

export interface SessionToolbarProps {
  connections: SavedConnection[];
  selectedConnectionId: string;
  dbName: string;
  filter: string;
  loading: boolean;
  onConnectionChange: (connectionId: string) => void;
  onDbNameChange: (dbName: string) => void;
  onApplyDatabase: () => void;
  onFilterChange: (filter: string) => void;
  onRefresh: () => void;
}

export default function SessionToolbar({
  connections,
  selectedConnectionId,
  dbName,
  filter,
  loading,
  onConnectionChange,
  onDbNameChange,
  onApplyDatabase,
  onFilterChange,
  onRefresh,
}: SessionToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="gn-session-workbench-toolbar">
      <div className="gn-session-workbench-toolbar-row">
        <Typography.Text className="gn-session-workbench-toolbar-label">
          {t('session_workbench.connection.label')}
        </Typography.Text>
        <Select
          aria-label={t('session_workbench.connection.label')}
          className="gn-session-workbench-connection-select"
          value={selectedConnectionId || undefined}
          placeholder={t('session_workbench.connection.placeholder')}
          options={connections.map((connection) => ({
            value: connection.id,
            label: connection.name,
          }))}
          onChange={onConnectionChange}
          showSearch
          optionFilterProp="label"
        />
        <Typography.Text className="gn-session-workbench-toolbar-label">
          {t('session_workbench.database.label')}
        </Typography.Text>
        <Input.Search
          aria-label={t('session_workbench.database.label')}
          className="gn-session-workbench-database-input"
          value={dbName}
          placeholder={t('session_workbench.database.placeholder')}
          enterButton={t('session_workbench.database.apply')}
          onChange={(event) => onDbNameChange(event.target.value)}
          onSearch={onApplyDatabase}
        />
        <Button
          type="default"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={onRefresh}
          aria-label={t('session_workbench.refresh')}
        >
          {t('session_workbench.refresh')}
        </Button>
      </div>
      <Space className="gn-session-workbench-filter" size={8}>
        <DatabaseOutlined aria-hidden="true" />
        <Typography.Text>{t('session_workbench.filter.label')}</Typography.Text>
        <Input
          allowClear
          value={filter}
          aria-label={t('session_workbench.filter.label')}
          placeholder={t('session_workbench.filter.placeholder')}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </Space>
    </div>
  );
}
