import React from 'react';
import { Button, Input, Select, Tooltip, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { useStore } from '../../store';
import type { TabData } from '../../types';
import { wailsSessionAgentApi, sessionAgentErrorText, type SessionAgentApi, type SessionAgentItem, type SessionBlockContent, type SessionContentRef, type SessionMessageView, type SessionTurnView } from './sessionAgentApi';
import { SessionAgentListPage } from './SessionAgentListPage';
import { SessionAgentDetailPanel, confirmSessionAgentDelete } from './SessionAgentDetailPanel';
import { loadSessionAgentListWidth, saveSessionAgentListWidth, SESSION_AGENT_LIST_DEFAULT_WIDTH, SessionAgentListResizeDivider } from './SessionAgentListResize';
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
  /** 该工具的会话总数（未筛选），用于展示筛选命中情况。 */
  const [scopeTotal, setScopeTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState('');
  /** 实际生效的搜索词（防抖后）。每敲一个键就重扫几百个会话文件，
   *  不防抖会把界面卡住好几秒。 */
  const [appliedQuery, setAppliedQuery] = React.useState('');
  React.useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  const [providerFilter, setProviderFilter] = React.useState(() => {
    // 点侧边栏智能体节点打开时，按该工具过滤（tab.agentIntegrationId
    // 即 kind）；没有指定则用记忆值或全部。
    if (tab.agentIntegrationId) {
      return tab.agentIntegrationId;
    }
    try {
      return localStorage.getItem('gonavi.sessionAgent.provider') ?? '';
    } catch {
      return '';
    }
  });
  // 已添加智能体：移除智能体后必须重新扫描，否则工作台仍显示着旧会话
  // （后端此时已无该智能体可扫）。下拉选项也只列已添加的工具。
  const agentIntegrations = useStore((state) => state.agentIntegrations);
  const agentKinds = React.useMemo(
    () => agentIntegrations.map((item) => item.integrationId).join(','),
    [agentIntegrations],
  );
  const providerOptions = React.useMemo(
    () => [
      { value: '', label: t('session_agent.list.filter_all') },
      ...agentIntegrations.map((item) => ({
        value: item.integrationId,
        label: item.displayName || item.integrationId,
      })),
    ],
    [agentIntegrations],
  );
  const [groupMode, setGroupMode] = React.useState(() => {
    try {
      return localStorage.getItem('gonavi.sessionAgent.groupMode') ?? 'project';
    } catch {
      return 'project';
    }
  });
  const [selected, setSelected] = React.useState<SessionAgentItem | null>(null);
  /** 是否有生效中的搜索（用于把筛选结果显式讲出来）。 */
  const filtering = appliedQuery.trim().length > 0;
  // 拖拽提交后的列表宽度（详情态）；未拖拽时用默认窄栏宽度。
  const [listWidth, setListWidth] = React.useState<number | undefined>(() => loadSessionAgentListWidth());
  // 列表宽度只在「详情展开」时有意义（那时列表是左侧窄条）；全页列表
  // 始终铺满工作区，不能被记住的窄栏宽度卡住。
  const listStyle = React.useMemo<React.CSSProperties>(() => {
    if (!selected) return {};
    const width = listWidth ?? SESSION_AGENT_LIST_DEFAULT_WIDTH;
    return { flexBasis: width, width, flexGrow: 0, flexShrink: 0 };
  }, [listWidth, selected]);
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

  // 选中的智能体被移除后，筛选值可能指向一个已不存在的工具：清掉它，
  // 避免下拉框落在空选项上、列表空着却看不出原因。必须等集成列表真的
  // 加载完再判断——「还没加载」和「一个都没添加」都是空列表。
  const agentIntegrationsLoaded = useStore((state) => state.agentIntegrationsLoaded);
  React.useEffect(() => {
    if (!agentIntegrationsLoaded) return;
    if (!providerFilter) return;
    if (providerOptions.some((option) => option.value === providerFilter)) return;
    setProviderFilter('');
  }, [agentIntegrationsLoaded, providerOptions, providerFilter]);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.list(providerFilter, appliedQuery);
      setItems(list);
      setTotal(list.length);
      // 搜索命中数之外，还要记住该工具的会话总数——否则筛完看不出
      // 「少了多少」，也不知道筛选到底生效没有。
      if (!appliedQuery.trim()) {
        setScopeTotal(list.length);
      }
      // 列表空了（例如智能体被移除）就把详情残留清掉，别让已经移除的
      // 会话正文继续挂在右侧。
      if (list.length === 0) {
        setSelected(null);
        setMessages([]);
        setTurns([]);
      }
    } catch (err) {
      message.error(sessionAgentErrorText(err, 'session_agent.error.list_failed'));
    } finally {
      setLoading(false);
    }
  }, [api, providerFilter, appliedQuery, agentKinds]);

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
    } catch (err) {
      message.error(sessionAgentErrorText(err, 'session_agent.error.detail_failed'));
      setMessages([]);
      setTurns([]);
    } finally {
      setDetailLoading(false);
    }
  }, [api]);

  // Esc 直接回到列表：详情里的「返回列表」按钮很小，且会话解析要十几秒，
  // 光靠找按钮不够好按。
  React.useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 有「可见」弹窗（删除确认等）打开时让弹窗自己处理 Esc。必须判可见：
      // 页面里常驻着隐藏的 .ant-modal-wrap 容器，按存在性判断会把 Esc 吞掉。
      const wrap = document.querySelector('.ant-modal-wrap');
      if (wrap && wrap.getBoundingClientRect().height > 0) return;
      setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  const handleExport = React.useCallback(async () => {
    if (!selected) return;
    try {
      const markdown = await api.exportMarkdown(selected.providerId, selected.sourcePath);
      if (!markdown) {
        message.warning(t('session_agent.error.export_failed'));
        return;
      }
      await navigator.clipboard.writeText(markdown);
      message.success(t('session_agent.action.export_done'));
    } catch (err) {
      message.error(sessionAgentErrorText(err, 'session_agent.error.export_failed'));
    }
  }, [api, selected]);

  const handleCopyResume = React.useCallback(async () => {
    if (!selected) return;
    try {
      const command = await api.copyResume(selected.providerId, selected.sessionId);
      if (!command) {
        message.warning(t('session_agent.error.resume_unavailable'));
        return;
      }
      await navigator.clipboard.writeText(command);
      message.success(t('session_agent.action.copy_resume_done'));
    } catch (err) {
      message.error(sessionAgentErrorText(err, 'session_agent.error.resume_unavailable'));
    }
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
    <div className="gn-session-agent-workbench" data-session-agent-workbench="true">
      <header className="gn-session-agent-header">
        <h2 className="gn-session-agent-heading">{t('session_agent.workbench.heading')}</h2>
        <p className="gn-session-agent-description">{t('session_agent.workbench.description')}</p>
      </header>
      <div className="gn-session-agent-toolbar">
        <div className="gn-session-agent-toolbar-row">
          <Input
            allowClear
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            prefix={<SearchOutlined />}
            placeholder={t('session_agent.list.search_placeholder')}
            aria-label={t('session_agent.list.search_placeholder')}
            className="gn-session-agent-search"
          />
          <Select
            size="small"
            value={providerFilter}
            onChange={setProviderFilter}
            className="gn-session-agent-filter"
            aria-label={t('session_agent.list.filter_label')}
            options={providerOptions}
          />
          <Select
            size="small"
            value={groupMode}
            onChange={setGroupMode}
            className="gn-session-agent-filter"
            aria-label={t('session_agent.list.group_label')}
            options={[
              { value: 'project', label: t('session_agent.list.group_project') },
              { value: 'time', label: t('session_agent.list.group_time') },
            ]}
          />
          <Tooltip title={t('session_agent.list.refresh')}>
            <ReloadOutlined
              className="gn-session-agent-reload"
              onClick={() => { void reload(); }}
              aria-label={t('session_agent.list.refresh')}
            />
          </Tooltip>
          <span className="gn-session-agent-toolbar-summary">
            {filtering
              ? t('session_agent.list.matched', { matched: total, total: scopeTotal })
              : t('session_agent.list.total', { count: total })}
          </span>
          {filtering ? (
            <Button
              size="small"
              className="gn-session-agent-clear-filter"
              onClick={() => setQuery('')}
            >
              {t('session_agent.list.clear_filter')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className={`gn-session-agent-workbench-columns${selected ? ' detail-open' : ''}`}>
        <SessionAgentListPage
          items={items}
          loading={loading}
          groupMode={groupMode}
          selectedPath={selected?.sourcePath ?? ''}
          compact={Boolean(selected)}
          style={listStyle}
          onSelect={handleSelect}
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
