import React from 'react';
import { Empty, Input, Select, Spin, Tooltip } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAgentItem } from './sessionAgentApi';
import { projectDisplayName, shortenSessionPreview, shortenSessionTitle } from './sessionAgentRow';

/**
 * 会话列表面板：主信息为截断后的标题，副标题为最后输入预览，
 * 辅助显示项目名、工具与时间。按时间分组展示（今天/昨天/本周/更早）。
 */
export const SessionAgentListPanel: React.FC<{
  items: SessionAgentItem[];
  total: number;
  loading: boolean;
  query: string;
  providerFilter: string;
  groupMode: string;
  selectedPath: string;
  style?: React.CSSProperties;
  onQueryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onGroupModeChange: (value: string) => void;
  onSelect: (item: SessionAgentItem) => void;
  onReload: () => void;
}> = ({ items, total, loading, query, providerFilter, groupMode, selectedPath, style, onQueryChange, onProviderFilterChange, onGroupModeChange, onSelect, onReload }) => (
  <aside className="session-agent-list" style={style} data-session-agent-list="true">
    <div className="session-agent-list-toolbar">
      <Input
        allowClear
        size="small"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        prefix={<SearchOutlined />}
        placeholder={t('session_agent.list.search_placeholder')}
        aria-label={t('session_agent.list.search_placeholder')}
      />
      <Select
        size="small"
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
        size="small"
        value={groupMode}
        onChange={onGroupModeChange}
        className="session-agent-list-filter"
        aria-label={t('session_agent.list.group_label')}
        options={[
          { value: 'time', label: t('session_agent.list.group_time') },
          { value: 'project', label: t('session_agent.list.group_project') },
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
    <div className="session-agent-list-body">
      {loading && items.length === 0 ? (
        <div className="session-agent-list-loading"><Spin /></div>
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_agent.list.empty')} />
      ) : (
        renderGroups(items, groupMode, selectedPath, onSelect)
      )}
    </div>
    <div className="session-agent-list-footer">
      {t('session_agent.list.total', { count: total })}
    </div>
  </aside>
);

// 按时间/项目分组渲染列表。
const renderGroups = (
  items: SessionAgentItem[],
  groupMode: string,
  selectedPath: string,
  onSelect: (item: SessionAgentItem) => void,
): React.ReactNode => {
  const groups = new Map<string, SessionAgentItem[]>();
  for (const item of items) {
    const key = groupMode === 'project'
      ? (projectDisplayName(item.projectDir) || '—')
      : timeGroupKey(item.lastActiveAt || item.createdAt);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return [...groups.entries()].map(([key, group]) => (
    <section key={key} className="session-agent-group" data-session-agent-group={key}>
      <h4 className="session-agent-group-title">{groupLabel(key, groupMode)}</h4>
      {group.map((item) => (
        <button
          key={item.sourcePath}
          type="button"
          className={
            item.sourcePath === selectedPath
              ? 'session-agent-row selected'
              : 'session-agent-row'
          }
          onClick={() => onSelect(item)}
        >
          <span className="session-agent-row-top">
            <span className="session-agent-row-title" title={item.title || item.sessionId}>
              {shortenSessionTitle(item.title || item.sessionId)}
            </span>
            <span className="session-agent-row-time">
              {item.lastActiveAt > 0 ? new Date(item.lastActiveAt).toLocaleDateString() : ''}
            </span>
          </span>
          {item.summary ? (
            <span className="session-agent-row-preview" title={item.summary}>
              {shortenSessionPreview(item.summary)}
            </span>
          ) : null}
          <span className="session-agent-row-states">
            <span className="session-agent-row-project" title={item.projectDir || ''}>
              {projectDisplayName(item.projectDir) || '—'}
            </span>
            <span className="session-agent-row-provider">
              {item.providerId === 'claude' ? 'Claude' : 'ChatGPT'}
            </span>
          </span>
        </button>
      ))}
    </section>
  ));
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

const groupLabel = (key: string, groupMode: string): string => {
  if (groupMode === 'project') return key;
  switch (key) {
    case 'today': return t('session_agent.group.today');
    case 'yesterday': return t('session_agent.group.yesterday');
    case 'week': return t('session_agent.group.week');
    default: return t('session_agent.group.older');
  }
};
