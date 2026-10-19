import React from 'react';
import { message } from 'antd';
import { t } from '../../i18n';
import type { TabData } from '../../types';
import { wailsSessionAgentApi, type SessionAgentApi, type SessionAgentItem, type SessionBlockContent, type SessionContentRef, type SessionMessageView, type SessionTurnView } from './sessionAgentApi';
import { SessionAgentListPage } from './SessionAgentListPage';
import { SessionAgentDetailPanel, confirmSessionAgentDelete } from './SessionAgentDetailPanel';
import { loadSessionAgentListWidth, saveSessionAgentListWidth, SessionAgentListResizeDivider } from './SessionAgentListResize';
import './SessionAgentWorkbench.css';

/**
 * 会话管理工作台：两态布局——进入即全页列表；点会话后列表挤压到左侧
 * 窄条、右侧展开聊天风格详情；「返回」恢复全页。纯只读浏览本机智能体
 * 会话（方案参考 cc-switch 会话管理器）。
 */
export const SessionAgentWorkbench: React.FC<{
  tab: TabData;
  api?: SessionAgentApi;
}> = ({ tab, api = wailsSessionAgentApi }) => {
  const [items, setItems] = React.useState<SessionAgentItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState(() => {
    try {
      return localStorage.getItem('gonavi.sessionAgent.provider') ?? '';
    } catch {
      return '';
    }
  });
  const [groupMode, setGroupMode] = React.useState(() => {
    try {
      return localStorage.getItem('gonavi.sessionAgent.groupMode') ?? 'project';
    } catch {
      return 'project';
    }
  });
  const [selected, setSelected] = React.useState<SessionAgentItem | null>(null);
  // 拖拽提交后的列表宽度（详情态）；未拖拽时用 CSS 默认值。
  const [listWidth, setListWidth] = React.useState<number | undefined>(() => loadSessionAgentListWidth());
  const listStyle = React.useMemo<React.CSSProperties>(
    () => (listWidth ? { flexBasis: listWidth, width: listWidth, flexGrow: 0, flexShrink: 0 } : {}),
    [listWidth],
  );
  const [messages, setMessages] = React.useState<SessionMessageView[]>([]);
  const [turns, setTurns] = React.useState<SessionTurnView[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);

  // 筛选/分组状态记忆。
  React.useEffect(() => {
    try {
      localStorage.setItem('gonavi.sessionAgent.provider', providerFilter);
      localStorage.setItem('gonavi.sessionAgent.groupMode', groupMode);
    } catch {
      // 存储不可用时跳过。
    }
  }, [providerFilter, groupMode]);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.list(providerFilter, query);
      setItems(list);
      setTotal(list.length);
    } catch {
      message.error(t('session_agent.error.list_failed'));
    } finally {
      setLoading(false);
    }
  }, [api, providerFilter, query]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const handleSelect = React.useCallback(async (item: SessionAgentItem) => {
    setSelected(item);
    setDetailLoading(true);
    try {
      const detail = await api.detail(item.providerId, item.sourcePath);
      setMessages(detail?.messages ?? []);
      setTurns(detail?.turns ?? []);
    } catch {
      message.error(t('session_agent.error.detail_failed', { detail: '' }));
      setMessages([]);
      setTurns([]);
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
      <div className={`session-agent-workbench-columns${selected ? ' detail-open' : ''}`}>
        <SessionAgentListPage
          items={items}
          total={total}
          loading={loading}
          query={query}
          providerFilter={providerFilter}
          groupMode={groupMode}
          selectedPath={selected?.sourcePath ?? ''}
          style={listStyle}
          onQueryChange={setQuery}
          onProviderFilterChange={setProviderFilter}
          onGroupModeChange={setGroupMode}
          onSelect={handleSelect}
          onReload={reload}
        />
        {selected ? (
          <>
            <SessionAgentListResizeDivider onCommit={(width) => { setListWidth(width); saveSessionAgentListWidth(width); }} />
            <SessionAgentDetailPanel
              item={selected}
              messages={messages}
              turns={turns}
              loading={detailLoading}
              onBack={() => setSelected(null)}
              onReload={() => handleSelect(selected)}
              onExport={handleExport}
              onCopyResume={handleCopyResume}
              onDelete={handleDelete}
              onOpenFull={handleOpenFull}
            />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default SessionAgentWorkbench;
