import React from 'react';
import { Empty, Input, Select, Spin, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAssetView } from './sessionAssetsApi';

/**
 * 会话列表面板：主信息为标题，辅助显示项目、provider 与原记录/备份
 * 两个状态维度（交互设计 §4.1）。不默认展开内部 ID。
 */
export const SessionAssetsListPanel: React.FC<{
  items: SessionAssetView[];
  total: number;
  loading: boolean;
  query: string;
  backupFilter: string;
  selectedId: string;
  onQueryChange: (value: string) => void;
  onBackupFilterChange: (value: string) => void;
  onSelect: (asset: SessionAssetView) => void;
  onReload: () => void;
}> = ({ items, total, loading, query, backupFilter, selectedId, onQueryChange, onBackupFilterChange, onSelect, onReload }) => (
  <aside className="session-assets-list" data-session-assets-list="true">
    <div className="session-assets-list-toolbar">
      <Input
        allowClear
        size="small"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        prefix={<SearchOutlined />}
        placeholder={t('session_assets.list.search_placeholder')}
        aria-label={t('session_assets.list.search_placeholder')}
      />
      <Select
        size="small"
        value={backupFilter}
        onChange={onBackupFilterChange}
        className="session-assets-list-filter"
        aria-label={t('session_assets.list.filter_label')}
        options={[
          { value: '', label: t('session_assets.list.filter_all') },
          { value: 'verified', label: t('session_assets.list.filter_backup') },
          { value: 'none', label: t('session_assets.list.filter_unbacked') },
          { value: 'incomplete', label: t('session_assets.list.filter_needs_attention') },
        ]}
      />
      <Tooltip title={t('session_assets.list.refresh')}>
        <ReloadOutlined
          className="session-assets-list-reload"
          onClick={onReload}
          aria-label={t('session_assets.list.refresh')}
        />
      </Tooltip>
    </div>
    <div className="session-assets-list-body">
      {loading && items.length === 0 ? (
        <div className="session-assets-list-loading"><Spin /></div>
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_assets.workbench.assets_empty')} />
      ) : (
        items.map((asset) => (
          <button
            key={asset.id}
            type="button"
            className={
              asset.id === selectedId
                ? 'session-assets-row selected'
                : 'session-assets-row'
            }
            onClick={() => onSelect(asset)}
          >
            <span className="session-assets-row-title" title={asset.title || asset.nativeThreadId}>
              {asset.title || asset.nativeThreadId}
            </span>
            <span className="session-assets-row-meta">
              <span className="session-assets-row-project">{asset.projectDir || '—'}</span>
              <span className="session-assets-row-provider">{asset.provider || '—'}</span>
            </span>
            <span className="session-assets-row-states">
              <SourceStateTag asset={asset} />
              <BackupStateTag asset={asset} />
              <span className="session-assets-row-time">
                {asset.updatedAt > 0 ? new Date(asset.updatedAt * 1000).toLocaleDateString() : ''}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
    <div className="session-assets-list-footer">
      {t('session_assets.list.total', { count: total })}
    </div>
  </aside>
);

const SourceStateTag: React.FC<{ asset: SessionAssetView }> = ({ asset }) => {
  const key =
    asset.sourceStatus === 'deleted'
      ? 'session_assets.state.source.deleted'
      : asset.sourceStatus === 'archived'
        ? 'session_assets.state.source.archived'
        : asset.sourceStatus === 'active'
          ? 'session_assets.state.source.active'
          : 'session_assets.state.source.unknown';
  return (
    <span className={`session-assets-tag source-${asset.sourceStatus || 'unknown'}`} data-source-state={asset.sourceStatus}>
      {t(key)}
    </span>
  );
};

const BackupStateTag: React.FC<{ asset: SessionAssetView }> = ({ asset }) => {
  const key = !asset.hasBackup
    ? 'session_assets.state.backup.none'
    : asset.backupStatus === 'incomplete'
      ? 'session_assets.state.backup.incomplete'
      : asset.backupStatus === 'update_failed'
        ? 'session_assets.state.backup.update_failed'
        : 'session_assets.state.backup.verified';
  return (
    <span className={`session-assets-tag backup-${asset.backupStatus || 'none'}`} data-backup-state={asset.backupStatus}>
      {t(key)}
    </span>
  );
};
