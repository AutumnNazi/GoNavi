import React from 'react';
import { Empty, Input, Select, Spin, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAgentItem } from './sessionAgentApi';
import { projectDisplayName, shortenSessionPreview, shortenSessionTitle } from './sessionAgentRow';

/**
 * 会话列表页（进入即全页）：单列卡片流。工具筛选 + 四字段搜索 +
 * 按项目/按时间分组，分组可展开收起，全部状态记 localStorage。
 */
export const SessionAgentListPage: React.FC<{
  items: SessionAgentItem[];
  total: number;
  loading: boolean;
  query: string;
  providerFilter: string;
  groupMode: string;
  selectedPath: string;
  onQueryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onGroupModeChange: (value: string) => void;
  onSelect: (item: SessionAgentItem) => void;
  onReload: () => void;
}> = ({ items, total, loading, query, providerFilter, groupMode, selectedPath, onQueryChange, onProviderFilterChange, onGroupModeChange, onSelect, onReload }) => {
  // 分组展开/收起状态记忆（按组键存 localStorage）。
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('gonavi.sessionAgent.collapsed') || '{}');
    } catch {
      return {};
    }
  });
  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('gonavi.sessionAgent.collapsed', JSON.stringify(next));
      } catch {
        // 存储不可用时不阻断交互。
      }
      return next;
    });
  };

  const groups = React.useMemo(() => buildGroups(items, groupMode), [items, groupMode]);

  return (
    <div className="session-agent-listpage" data-session-agent-list="true">
      <div className="session-agent-list-toolbar">
        <Input
          allowClear
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          prefix={<SearchOutlined />}
          placeholder={t('session_agent.list.search_placeholder')}
          aria-label={t('session_agent.list.search_placeholder')}
        />
        <Select
          value={providerFilter}
          onChange={onProviderFilterChange}
          className="session-agent-list-filter"
          aria-label={t('session_agent.list.filter_label')}
          options={[
            { value: '', label: t('session_agent.list.filter_all') },
            { value: 'codex', label: 'ChatGPT' },
            { value: 'claude', label: 'Claude Code' },
          ]}
        />
        <Select
          value={groupMode}
          onChange={onGroupModeChange}
          className="session-agent-list-filter"
          aria-label={t('session_agent.list.group_label')}
          options={[
            { value: 'project', label: t('session_agent.list.group_project') },
            { value: 'time', label: t('session_agent.list.group_time') },
          ]}
        />
        <Tooltip title={t('session_agent.list.refresh')}>
          <ReloadOutlined
            className="session-agent-list-reload"
            onClick={onReload}
            aria-label={t('session_agent.list.refresh')}
          />
        </Tooltip>
      </div>
      <div className="session-agent-listpage-body">
        {loading && items.length === 0 ? (
          <div className="session-agent-list-loading"><Spin /></div>
        ) : items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_agent.list.empty')} />
        ) : (
          groups.map(({ key, label, group }) => (
            <section key={key} className="session-agent-group" data-session-agent-group={key}>
              <header
                className="session-agent-group-head"
                onClick={() => toggleGroup(key)}
                role="button"
                aria-expanded={!collapsed[key]}
              >
                <span className={`session-agent-group-caret${collapsed[key] ? '' : ' open'}`}>▶</span>
                <span className="session-agent-group-title">{label}</span>
                <span className="session-agent-group-count">
                  {t('session_agent.list.total', { count: group.length })}
                </span>
              </header>
              {!collapsed[key] && group.map((item) => (
                <SessionCard
                  key={item.sourcePath}
                  item={item}
                  groupMode={groupMode}
                  selected={item.sourcePath === selectedPath}
                  onSelect={onSelect}
                />
              ))}
            </section>
          ))
        )}
      </div>
      <div className="session-agent-list-footer">
        {t('session_agent.list.total', { count: total })}
      </div>
    </div>
  );
};

// 会话卡片：头像+标题+时间 / 首次 / 最后 / 脚标（厂商 + 按时间时的项目）。
const SessionCard: React.FC<{
  item: SessionAgentItem;
  groupMode: string;
  selected: boolean;
  onSelect: (item: SessionAgentItem) => void;
}> = ({ item, groupMode, selected, onSelect }) => (
  <article
    className={selected ? 'session-agent-card selected' : 'session-agent-card'}
    onClick={() => onSelect(item)}
    data-session-agent-card="true"
  >
    <div className="session-agent-card-top">
      <ProviderAvatar providerId={item.providerId} />
      <span className="session-agent-card-title" title={item.title || item.sessionId}>
        {shortenSessionTitle(item.title || item.sessionId)}
      </span>
      <span className="session-agent-card-time">{relativeTime(item.lastActiveAt || item.createdAt)}</span>
    </div>
    {item.firstMessage ? (
      <div className="session-agent-card-line">
        <span className="k">{t('session_agent.card.first')}</span>
        <span className="v" title={item.firstMessage}>{shortenSessionPreview(item.firstMessage, 64)}</span>
      </div>
    ) : null}
    {item.summary ? (
      <div className="session-agent-card-line">
        <span className="k">{t('session_agent.card.last')}</span>
        <span className="v" title={item.summary}>{shortenSessionPreview(item.summary, 64)}</span>
      </div>
    ) : null}
    <div className="session-agent-card-foot">
      <ProviderBadge providerId={item.providerId} />
      {groupMode === 'time' && item.projectDir ? (
        <span className="session-agent-card-badge" title={item.projectDir}>
          {projectDisplayName(item.projectDir)}
        </span>
      ) : null}
    </div>
  </article>
);

// 厂商头像（OpenAI 花结 / Anthropic 星芒，用文字符号占位保持轻量）。
export const ProviderAvatar: React.FC<{ providerId: string }> = ({ providerId }) => (
  <span className={`session-agent-avatar ${providerId === 'claude' ? 'is-claude' : 'is-codex'}`}>
    {providerId === 'claude' ? '✳' : '✳'}
  </span>
);

export const ProviderBadge: React.FC<{ providerId: string }> = ({ providerId }) => (
  <span className="session-agent-card-badge provider">
    <span className={`dot ${providerId === 'claude' ? 'dot-claude' : 'dot-codex'}`} />
    {providerId === 'claude' ? 'Claude Code' : 'ChatGPT'}
  </span>
);

// 相对时间（今天显示时刻，其余显示日期/相对天数）。
export const relativeTime = (ts: number): string => {
  if (!ts) return '';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= todayStart) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const days = Math.floor((todayStart - ts) / 86400000);
  if (days === 1) return t('session_agent.time.yesterday');
  if (days < 30) return t('session_agent.time.days_ago', { count: days });
  return new Date(ts).toLocaleDateString();
};

// 分组构建：按项目（项目名）或按时间（今天/昨天/本周/更早）。
export const buildGroups = (
  items: SessionAgentItem[],
  groupMode: string,
): Array<{ key: string; label: string; group: SessionAgentItem[] }> => {
  const map = new Map<string, SessionAgentItem[]>();
  for (const item of items) {
    const key = groupMode === 'project'
      ? (projectDisplayName(item.projectDir) || '—')
      : timeGroupKey(item.lastActiveAt || item.createdAt);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return [...map.entries()].map(([key, group]) => ({
    key,
    label: groupMode === 'project' ? key : timeGroupLabel(key),
    group,
  }));
};

const timeGroupKey = (ts: number): string => {
  if (!ts) return 'older';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekStart = today - 6 * 86400000;
  if (ts >= today) return 'today';
  if (ts >= yesterday) return 'yesterday';
  if (ts >= weekStart) return 'week';
  return 'older';
};

const timeGroupLabel = (key: string): string => {
  switch (key) {
    case 'today': return t('session_agent.group.today');
    case 'yesterday': return t('session_agent.group.yesterday');
    case 'week': return t('session_agent.group.week');
    default: return t('session_agent.group.older');
  }
};
