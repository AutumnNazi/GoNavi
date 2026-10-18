import React from 'react';
import { Alert, message } from 'antd';
import { t } from '../../i18n';
import type { TabData } from '../../types';
import { wailsSessionAgentApi, type SessionAgentApi, type SessionAgentItem, type SessionBlockContent, type SessionContentRef, type SessionMessageView, type SessionTurnView } from './sessionAgentApi';
import { SessionAgentListPanel } from './SessionAgentListPanel';
import { SessionAgentDetailPanel, confirmSessionAgentDelete } from './SessionAgentDetailPanel';
import { SessionAgentListResizeDivider } from './SessionAgentListResize';
import './SessionAgentWorkbench.css';

/**
 * 会话管理工作台：主从布局（列表 + 详情），纯只读浏览本机智能体会话。
 * 方案参考 cc-switch 会话管理器；视觉沿用 GoNavi v2 主题（行布局、
 * 分割线、页签约束保持与 sessionAssets 已验收实现一致）。
 */
export const SessionAgentWorkbench: React.FC<{
  tab: TabData;
  api?: SessionAgentApi;
}> = ({ tab, api = wailsSessionAgentApi }) => {
  const [items, setItems] = React.useState<SessionAgentItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState('');
  const [groupMode, setGroupMode] = React.useState('time');
  const [selected, setSelected] = React.useState<SessionAgentItem | null>(null);
  const [messages, setMessages] = React.useState<SessionMessageView[]>([]);
  const [turns, setTurns] = React.useState<SessionTurnView[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.list(providerFilter, query);
      setItems(list);
      setTotal(list.length);
    } finally {
      setLoading(false);
    }
  }, [api, providerFilter, query]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handleSelect = React.useCallback(async (item: SessionAgentItem) => {
    setSelected(item);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const detail = await api.detail(item.providerId, item.sourcePath);
      setMessages(detail?.messages ?? []);
      setTurns(detail?.turns ?? []);
    } finally {
      setDetailLoading(false);
    }
  }, [api]);

  const handleExport = React.useCallback(async () => {
    if (!selected) return;
    const markdown = await api.exportMarkdown(selected.providerId, selected.sourcePath);
    if (!markdown) {
      message.warning(t('session_agent.error.export_failed'));
      return;
    }
    await navigator.clipboard.writeText(markdown);
    message.success(t('session_agent.action.export_done'));
  }, [api, selected]);

  const handleCopyResume = React.useCallback(async () => {
    if (!selected) return;
    const command = await api.copyResume(selected.providerId, selected.sessionId);
    if (!command) {
      message.warning(t('session_agent.error.resume_unavailable'));
      return;
    }
    await navigator.clipboard.writeText(command);
    message.success(t('session_agent.action.copy_resume_done'));
  }, [api, selected]);

  const handleDelete = React.useCallback(() => {
    if (!selected) return;
    confirmSessionAgentDelete(selected, async () => {
      const ok = await api.delete(selected.providerId, selected.sourcePath, selected.sessionId);
      if (ok) {
        message.success(t('session_agent.delete.done'));
        setSelected(null);
        setDetailOpen(false);
        await reload();
      } else {
        message.error(t('session_agent.error.delete_failed'));
      }
    });
  }, [api, selected, reload]);

  const handleOpenFull = React.useCallback(async (ref: SessionContentRef): Promise<SessionBlockContent | null> => {
    if (!selected) return null;
    return api.blockContent(selected.providerId, selected.sourcePath, ref, 0, 0);
  }, [api, selected]);

  return (
    <div className="session-agent-workbench" data-session-agent-workbench="true">
      <div className="session-agent-workbench-columns">
        <SessionAgentListPanel
          items={items}
          total={total}
          loading={loading}
          query={query}
          providerFilter={providerFilter}
          groupMode={groupMode}
          selectedPath={selected?.sourcePath ?? ''}
          onQueryChange={setQuery}
          onProviderFilterChange={setProviderFilter}
          onGroupModeChange={setGroupMode}
          onSelect={handleSelect}
          onReload={reload}
        />
        <SessionAgentListResizeDivider onCommit={() => undefined} />
        {selected ? (
          <SessionAgentDetailPanel
            item={selected}
            messages={messages}
            turns={turns}
            loading={detailLoading}
            onBackToList={() => { setSelected(null); setDetailOpen(false); }}
            onReload={() => handleSelect(selected)}
            onExportMarkdown={handleExport}
            onCopyResume={handleCopyResume}
            onDelete={handleDelete}
            onOpenFull={handleOpenFull}
          />
        ) : (
          <div className="session-agent-detail-empty" data-session-agent-empty="true">
            <div className="session-agent-detail-empty-body">
              <h3 className="session-agent-detail-empty-title">{t('session_agent.workbench.pick_hint')}</h3>
              <p className="session-agent-detail-empty-hint">{t('session_agent.workbench.pick_hint_detail')}</p>
            </div>
          </div>
        )}
      </div>
      <Alert
        className="session-agent-workbench-notice"
        type="info"
        showIcon
        message={t('session_agent.workbench.readonly_notice')}
      />
    </div>
  );
};

export default SessionAgentWorkbench;
