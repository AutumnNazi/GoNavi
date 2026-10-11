import React from 'react';
import { Alert, Button, Modal, Spin, Tabs, Tooltip } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, ExportOutlined, PlayCircleOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAssetDetail, SessionHistoryEntry, SessionHistoryPage } from './sessionAssetsApi';
import { SessionAssetHistoryView } from './SessionAssetHistoryView';
import { SessionAssetMaterialsView } from './SessionAssetMaterialsView';

/** 读源带里只展示文件名，完整路径放在 Tooltip。 */
export const readBandFileName = (path: string): string => {
  const normalized = String(path || '').replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  return base || String(path || '');
};

/**
 * 会话详情面板：顶部读源带指明正在读取原工具还是哪次备份（交互设计
 * §5.1），历史与材料分页呈现；动作区按能力判定提供继续原会话、携带
 * 历史新建、导出与删除（D-05）。
 */
export const SessionAssetDetailPanel: React.FC<{
  detail: SessionAssetDetail | null;
  loading: boolean;
  historyPage: SessionHistoryPage | null;
  historyLoading: boolean;
  capability: { nativeResume: boolean; newSession: boolean; manualMaterial: boolean } | null;
  onLoadMore: () => void;
  onExport: (mode: 'raw' | 'readable') => void;
  onDelete: () => void;
  onReread: () => void;
  onRetry: () => void;
  onBackToList: () => void;
  onContinue: () => void;
  onNewSession: () => void;
}> = ({ detail, loading, historyPage, historyLoading, capability, onLoadMore, onExport, onDelete, onReread, onContinue, onNewSession, onRetry, onBackToList }) => {
  if (loading || !detail) {
    return <div className="session-assets-detail-loading"><Spin /></div>;
  }
  const readSourceKey =
    detail.readSource === 'live'
      ? 'session_assets.detail.read_source.live'
      : detail.readSource === 'backup'
        ? 'session_assets.detail.read_source.backup'
        : 'session_assets.detail.read_source.missing';
  const nativeResumeAvailable = capability?.nativeResume === true;
  return (
    <section className="session-assets-detail" data-session-assets-detail="true">
      <header className="session-assets-detail-head">
        <div className="session-assets-detail-titleline">
          <h3 className="session-assets-detail-title">{detail.title || detail.nativeThreadId}</h3>
          <span className="session-assets-detail-meta">
            {detail.projectDir || '—'} · {detail.provider || '—'} · {detail.model || ''}
          </span>
        </div>
        <div className="session-assets-detail-actions">
          <Button
            className="session-assets-back-btn"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={onBackToList}
          >
            {t('session_assets.action.back_to_list')}
          </Button>
          <Tooltip title={t('session_assets.action.reload_sources')}>
            <Button size="small" icon={<ReloadOutlined />} onClick={onReread} aria-label={t('session_assets.action.reload_sources')} />
          </Tooltip>
          <Tooltip title={nativeResumeAvailable ? undefined : t('session_assets.action.resume_unavailable_hint')}>
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!nativeResumeAvailable}
              onClick={onContinue}
            >
              {t('session_assets.action.resume')}
            </Button>
          </Tooltip>
          <Tooltip title={capability?.newSession ? undefined : t('session_assets.action.new_session_unavailable_hint')}>
            <Button
              size="small"
              icon={<SendOutlined />}
              disabled={capability?.newSession !== true}
              onClick={onNewSession}
            >
              {t('session_assets.action.new_session')}
            </Button>
          </Tooltip>
          <Button size="small" icon={<ExportOutlined />} disabled={!detail.hasBackup} onClick={() => onExport('raw')}>
            {t('session_assets.action.export_raw')}
          </Button>
          <Button size="small" icon={<ExportOutlined />} disabled={!detail.hasBackup} onClick={() => onExport('readable')}>
            {t('session_assets.action.export_readable')}
          </Button>
          {detail.recentJobs?.some((job) => job.status === 'failed') ? (
            <Tooltip title={t('session_assets.action.retry_hint')}>
              <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
                {t('session_assets.action.retry_capture')}
              </Button>
            </Tooltip>
          ) : null}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete}>
            {t('session_assets.action.delete')}
          </Button>
        </div>
      </header>

      {/* 读源带：单行紧凑展示；完整路径悬停可见，不再占整块面板。 */}
      <Tooltip title={detail.readPath} placement="bottomLeft">
        <Alert
          className="session-assets-readband"
          type={
            detail.readSource === 'live' ? 'success'
              : detail.readSource === 'backup' ? 'info'
                : 'warning'
          }
          showIcon
          message={
            detail.readSource === 'backup' && detail.coverageAt > 0
              ? t('session_assets.detail.read_source.coverage', {
                  time: new Date(detail.coverageAt * 1000).toLocaleString(),
                })
              : detail.readSource === 'backup'
                ? t(readSourceKey)
                : detail.readSource === 'live'
                  ? `${t(readSourceKey)} · ${readBandFileName(detail.readPath)}`
                  : t(readSourceKey)
          }
        />
      </Tooltip>

      {detail.recentJobs?.some((job) => job.status === 'failed') ? (
        <Alert
          type="warning"
          showIcon
          message={t('session_assets.history.failed_title')}
          description={detail.recentJobs
            .filter((job) => job.status === 'failed')
            .map((job) => (
              <div key={job.id}>{job.error || t('session_assets.history.unknown')}</div>
            ))}
        />
      ) : null}

      <Tabs
        size="small"
        className="session-assets-detail-tabs gn-user-mgmt-editor-tabs"
        items={[
          {
            key: 'history',
            label: t('session_assets.detail.tab.history'),
            children: (
              <SessionAssetHistoryView
                page={historyPage}
                loading={historyLoading}
                onLoadMore={onLoadMore}
              />
            ),
          },
          {
            key: 'materials',
            label: t('session_assets.detail.tab.materials'),
            children: <SessionAssetMaterialsView detail={detail} />,
          },
        ]}
      />
    </section>
  );
};

/** 确认删除：列明清理范围，说明原工具会话不受影响（交互设计 §9）。 */
export const confirmSessionAssetDelete = (detail: SessionAssetDetail, onConfirm: () => void) => {
  Modal.confirm({
    title: t('session_assets.delete.title'),
    content: (
      <div data-session-assets-delete-confirm="true">
        <p>{t('session_assets.delete.body', { title: detail.title || detail.nativeThreadId })}</p>
        <ul>
          <li>{t('session_assets.delete.scope_backup', { complete: detail.latestComplete ? '✓' : '—' })}</li>
          <li>{t('session_assets.delete.scope_derived')}</li>
          <li>{t('session_assets.delete.scope_tool_untouched')}</li>
          <li>{t('session_assets.delete.scope_no_restore')}</li>
        </ul>
      </div>
    ),
    okText: t('session_assets.action.delete'),
    okButtonProps: { danger: true },
    cancelText: t('common.cancel'),
    onOk: onConfirm,
  });
};

export const HistoryListFallback: React.FC = () => <Spin />;

export type { SessionHistoryEntry };
