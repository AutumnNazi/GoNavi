import React from 'react';
import { Empty, Input, Select, Spin, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAssetView } from './sessionAssetsApi';
import { projectDisplayName, shortenSessionPreview, shortenSessionTitle } from './sessionAssetRow';

/**
 * 会话列表面板：主信息为截断后的标题，副标题为最后一次用户输入预览，
 * 辅助显示项目名与原记录/备份两个状态维度。不默认展开内部 ID。
 */
export const SessionAssetsListPanel: React.FC<{
  items: SessionAssetView[];
  total: number;
  loading: boolean;
  query: string;
  backupFilter: string;
  selectedId: string;
  /** 拖拽分割条提交后的列表宽度；未拖拽时用 CSS 默认值。 */
  style?: React.CSSProperties;
  onQueryChange: (value: string) => void;
  onBackupFilterChange: (value: string) => void;
  onSelect: (asset: SessionAssetView) => void;
  onReload: () => void;
}> = ({ items, total, loading, query, backupFilter, selectedId, style, onQueryChange, onBackupFilterChange, onSelect, onReload }) => (
  <aside className="session-assets-list" style={style} data-session-assets-list="true">
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
            <span className="session-assets-row-top">
              <span className="session-assets-row-title" title={asset.title || asset.nativeThreadId}>
                {shortenSessionTitle(asset.title || asset.nativeThreadId)}
              </span>
              <span className="session-assets-row-time">
                {asset.updatedAt > 0 ? new Date(asset.updatedAt * 1000).toLocaleDateString() : ''}
              </span>
            </span>
            {asset.lastUserPreview ? (
              <span className="session-assets-row-preview" title={asset.lastUserPreview}>
                {shortenSessionPreview(asset.lastUserPreview)}
              </span>
            ) : null}
            <span className="session-assets-row-states">
              <span className="session-assets-row-project" title={asset.projectDir || ''}>
                {projectDisplayName(asset.projectDir) || '—'}
              </span>
              <span className="session-assets-row-provider">{asset.provider || '—'}</span>
              <SourceStateTag asset={asset} />
              <BackupStateTag asset={asset} />
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
