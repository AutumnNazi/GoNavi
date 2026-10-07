import React from 'react';
import { message } from 'antd';
import { useStore } from '../../store';
import { t } from '../../i18n';
import type { TabData } from '../../types';
import {
  SessionAssetDetailPanel,
  confirmSessionAssetDelete,
} from './SessionAssetDetailPanel';
import { SessionAssetsListPanel } from './SessionAssetsListPanel';
import { wailsSessionAssetsApi, type SessionAssetDetail, type SessionHistoryPage, type SessionAssetsApi } from './sessionAssetsApi';
import { SessionAssetsNewSessionPanel } from './SessionAssetsNewSessionPanel';
import { useSessionAssetsList } from './useSessionAssetsList';
import './SessionAssetsWorkbench.css';

/**
 * 智能体会话资产工作台：一种工具一个唯一页签（固定 ID 激活已有页签）。
 * 左列表右详情；读取、导出与删除全部走后端真实状态，不显示伪造数据。
 */
export const SessionAssetsWorkbench: React.FC<{
  tab: TabData;
  isActive?: boolean;
  /** 测试注入用；缺省使用 Wails 实现。 */
  api?: SessionAssetsApi;
}> = ({ tab, api = wailsSessionAssetsApi }) => {
  const agentIntegrations = useStore((state) => state.agentIntegrations);
  const refreshAgentIntegrations = useStore((state) => state.refreshAgentIntegrations);
  const integrationId = tab.agentIntegrationId || '';
  const kind = agentIntegrations.find((item) => item.integrationId === integrationId)?.kind || 'codex';

  const { items, total, loading, filter, updateFilter, reload } = useSessionAssetsList(api, kind);
  const [selected, setSelected] = React.useState<SessionAssetDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [historyPage, setHistoryPage] = React.useState<SessionHistoryPage | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const selectedIdRef = React.useRef('');
  // 窄屏（≤900px）下列表与详情切换：点行进入详情全屏视图，返回按钮回列表
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);

  const openAsset = React.useCallback(async (assetId: string) => {
    selectedIdRef.current = assetId;
    setDetailLoading(true);
    setHistoryPage(null);
    try {
      const detail = await api.getAssetDetail(assetId);
      if (selectedIdRef.current !== assetId) return;
      setSelected(detail);
      if (detail?.hasBackup || detail?.readSource === 'live') {
        setHistoryLoading(true);
        const page = await api.readHistory(assetId, 0, 100);
        if (selectedIdRef.current === assetId) setHistoryPage(page);
        setHistoryLoading(false);
      }
    } finally {
      if (selectedIdRef.current === assetId) setDetailLoading(false);
    }
  }, []);

  const loadMoreHistory = React.useCallback(async () => {
    if (!historyPage?.hasMore || !selected) return;
    setHistoryLoading(true);
    try {
      const next = await api.readHistory(selected.id, historyPage.nextOffset, 100);
      if (next) {
        setHistoryPage({
          entries: [...historyPage.entries, ...next.entries],
          nextOffset: next.nextOffset,
          hasMore: next.hasMore,
          readSource: next.readSource,
        });
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, selected]);

  const handleExport = React.useCallback(async (mode: 'raw' | 'readable') => {
    if (!selected) return;
    const result = await api.exportAsset(selected.id, mode);
    if (result?.file) {
      message.success(t('session_assets.export.done', { file: result.file }));
    } else {
      message.warning(t('session_assets.export.cancelled_or_failed'));
    }
  }, [selected]);

  const handleDelete = React.useCallback(() => {
    if (!selected) return;
    confirmSessionAssetDelete(selected, async () => {
      const ok = await api.deleteAsset(selected.id);
      if (ok) {
        message.success(t('session_assets.delete.done'));
        setSelected(null);
        setHistoryPage(null);
        reload();
        void refreshAgentIntegrations();
      } else {
        message.error(t('session_assets.delete.failed'));
      }
    });
  }, [reload, refreshAgentIntegrations, selected]);

  const handleRetry = React.useCallback(async () => {
    if (!selected) return;
    const ok = await api.retryCapture(selected.id);
    if (ok) {
      message.success(t('session_assets.action.retry_enqueued'));
      await openAsset(selected.id);
    } else {
      message.error(t('session_assets.action.retry_failed'));
    }
  }, [api, openAsset, selected]);

  const handleReread = React.useCallback(async () => {
    await api.refreshSources(kind);
    reload();
    if (selected) await openAsset(selected.id);
  }, [kind, openAsset, reload, selected]);

  // 交接能力随详情加载；按钮禁用与提示按真实能力呈现（V-29）。
  const [capability, setCapability] = React.useState<{ nativeResume: boolean; newSession: boolean; manualMaterial: boolean } | null>(null);
  React.useEffect(() => {
    if (!selected) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    void api.getCapability(selected.id).then((next) => {
      if (!cancelled) setCapability(next);
    });
    return () => {
      cancelled = true;
    };
  }, [api, selected]);

  const handleContinue = React.useCallback(async () => {
    if (!selected) return;
    const result = await api.continueSession(selected.id);
    if (result?.stage === 'entry_launched') {
      message.success(t('session_assets.handoff.entry_launched'));
    } else {
      message.warning(t('session_assets.handoff.launch_failed'));
    }
  }, [selected]);

  const [newSessionOpen, setNewSessionOpen] = React.useState(false);
  const handleNewSession = React.useCallback(() => {
    if (!selected) return;
    setNewSessionOpen(true);
  }, [selected]);

  const handleSelect = React.useCallback(
    (view: { id: string }) => {
      setMobileDetailOpen(true);
      void openAsset(view.id);
    },
    [openAsset],
  );

  const closeMobileDetail = React.useCallback(() => setMobileDetailOpen(false), []);

  return (
    <div className="session-assets-workbench" data-session-assets-workbench="true">
      <div
        className={
          mobileDetailOpen
            ? 'session-assets-workbench-columns detail-open'
            : 'session-assets-workbench-columns'
        }
      >
        <SessionAssetsListPanel
          items={items}
          total={total}
          loading={loading}
          query={filter.query}
          backupFilter={filter.backupStatus}
          selectedId={selected?.id || ''}
          onQueryChange={(value) => updateFilter({ query: value })}
          onBackupFilterChange={(value) => updateFilter({ backupStatus: value })}
          onSelect={handleSelect}
          onReload={reload}
        />
        <SessionAssetDetailPanel
          detail={selected}
          loading={detailLoading}
          capability={capability}
          historyPage={historyPage}
          historyLoading={historyLoading}
          onLoadMore={() => void loadMoreHistory()}
          onExport={(mode) => void handleExport(mode)}
          onDelete={handleDelete}
          onReread={() => void handleReread()}
          onRetry={() => void handleRetry()}
          onBackToList={closeMobileDetail}
          onContinue={() => void handleContinue()}
          onNewSession={() => void handleNewSession()}
        />
      </div>
      {newSessionOpen && selected ? (
        <SessionAssetsNewSessionPanel detail={selected} api={api} onClose={() => setNewSessionOpen(false)} />
      ) : null}
      <footer className="session-assets-workbench-footer">
        {t('session_assets.workbench.protection_hint')}
      </footer>
    </div>
  );
};

export default SessionAssetsWorkbench;
