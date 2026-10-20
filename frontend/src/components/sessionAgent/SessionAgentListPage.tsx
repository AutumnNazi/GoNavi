import React from 'react';
import { Empty, Pagination, Spin, Tag, Tooltip } from 'antd';
import { FolderOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { GnClaudeIcon, GnOpenAIAgentIcon } from '../icons/gnIcons';
import type { SessionAgentItem } from './sessionAgentApi';
import { projectDisplayName, shortenSessionPreview, shortenSessionTitle } from './sessionAgentRow';

/**
 * 会话列表页（进入即全页）：按分组分区渲染——项目名（时间段）独占一行，
 * 下面才是该组的会话卡片。分组做成独立分区而不是表格的跨行单元格：
 * 表格每行固定渲染一列单元格，做不出真正的分组表头行。
 */

/** 一个分组（同项目或同时间段）。 */
export interface SessionGroup {
  key: string;
  label: string;
  items: SessionAgentItem[];
}

/** 每页显示多少个分组。 */
const GROUPS_PER_PAGE = 12;

export const SessionAgentListPage: React.FC<{
  items: SessionAgentItem[];
  loading: boolean;
  groupMode: string;
  selectedPath: string;
  /** 详情展开时列表收成窄栏。 */
  compact?: boolean;
  /** 拖拽分割条提交后的列表宽度；未拖拽时用 CSS 默认宽度。 */
  style?: React.CSSProperties;
  onSelect: (item: SessionAgentItem) => void;
}> = ({ items, loading, groupMode, selectedPath, compact = false, style, onSelect }) => {
  const groups = React.useMemo(() => buildSessionGroups(items, groupMode), [items, groupMode]);
  const [page, setPage] = React.useState(1);
  const pageCount = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const visible = React.useMemo(
    () => groups.slice((current - 1) * GROUPS_PER_PAGE, current * GROUPS_PER_PAGE),
    [groups, current],
  );

  React.useEffect(() => {
    setPage(1);
  }, [groups.length, groupMode]);

  if (loading && items.length === 0) {
    return (
      <div className="gn-session-agent-listpage" style={style} data-session-agent-list="true">
        <div className="gn-session-agent-listpage-body">
          <div className="gn-session-agent-loading"><Spin /></div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="gn-session-agent-listpage" style={style} data-session-agent-list="true">
        <div className="gn-session-agent-listpage-body">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_agent.list.empty')} />
        </div>
      </div>
    );
  }

  return (
    <div className="gn-session-agent-listpage" style={style} data-session-agent-list="true">
      <div className="gn-session-agent-listpage-body">
        {visible.map((group) => (
          <SessionGroupSection
            key={group.key}
            group={group}
            groupMode={groupMode}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="gn-session-agent-listpage-pager">
          <Pagination
            size="small"
            current={current}
            pageSize={GROUPS_PER_PAGE}
            total={groups.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        </div>
      ) : null}
    </div>
  );
};

/** 一个分组区：组头（项目名 + 会话数）+ 该组的会话卡片。 */
const SessionGroupSection: React.FC<{
  group: SessionGroup;
  groupMode: string;
  selectedPath: string;
  onSelect: (item: SessionAgentItem) => void;
}> = ({ group, groupMode, selectedPath, onSelect }) => (
  <section className="gn-session-agent-group" data-session-agent-group={group.key}>
    <header className="gn-session-agent-group-head">
      {groupMode === 'project' ? (
        <FolderOutlined className="gn-session-agent-group-icon" />
      ) : null}
      <span className="gn-session-agent-group-name" title={group.label}>{group.label}</span>
      <span className="gn-session-agent-group-count">
        {t('session_agent.list.total', { count: group.items.length })}
      </span>
    </header>
    <div className="gn-session-agent-group-body">
      {group.items.map((item) => (
        <SessionRow
          key={item.sourcePath}
          item={item}
          selected={item.sourcePath === selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  </section>
);

/** 会话卡片：标题 + fork 标记 + 厂商 + 时间，下面是首问预览。 */
const SessionRow: React.FC<{
  item: SessionAgentItem;
  selected: boolean;
  onSelect: (item: SessionAgentItem) => void;
}> = ({ item, selected, onSelect }) => (
  <article
    className={selected ? 'gn-session-agent-row is-selected' : 'gn-session-agent-row'}
    data-session-agent-row="true"
    onClick={() => onSelect(item)}
  >
    <div className="gn-session-agent-row-top">
      <span className="gn-session-agent-session-title" title={item.title || item.sessionId}>
        {shortenSessionTitle(item.title || item.sessionId)}
      </span>
      {item.forkedFrom ? (
        <Tooltip title={t('session_agent.list.fork_hint', { id: item.forkedFrom })}>
          <Tag className="gn-session-agent-fork-tag" data-session-agent-fork="true">
            {t('session_agent.list.fork')}
          </Tag>
        </Tooltip>
      ) : null}
      <ProviderBadge providerId={item.providerId} />
      <span className="gn-session-agent-time-cell">
        {relativeTime(item.lastActiveAt || item.createdAt)}
      </span>
    </div>
    {item.firstMessage ? (
      <span className="gn-session-agent-session-preview" title={item.firstMessage}>
        {shortenSessionPreview(item.firstMessage, 80)}
      </span>
    ) : null}
  </article>
);

// 厂商品牌图标：OpenAI 花结 / Anthropic 星芒，与新建连接面板同一套。
export const ProviderIcon: React.FC<{ providerId: string; className?: string }> = ({ providerId, className }) => {
  const Icon = providerId === 'claude' ? GnClaudeIcon : GnOpenAIAgentIcon;
  return <Icon className={className} />;
};

export const ProviderAvatar: React.FC<{ providerId: string }> = ({ providerId }) => (
  <span className={`gn-session-agent-avatar ${providerId === 'claude' ? 'is-claude' : 'is-codex'}`}>
    <ProviderIcon providerId={providerId} />
  </span>
);

export const ProviderBadge: React.FC<{ providerId: string }> = ({ providerId }) => (
  <Tag className={`gn-session-agent-provider-tag ${providerId === 'claude' ? 'is-claude' : 'is-codex'}`}>
    <ProviderIcon providerId={providerId} className="gn-session-agent-provider-tag-icon" />
    {providerId === 'claude' ? 'Claude Code' : 'ChatGPT'}
  </Tag>
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

/** 分组排序：按项目时同一项目的行相邻，按时间时按最后活跃倒序。 */
export const sortSessionItems = (
  items: SessionAgentItem[],
  groupMode: string,
): SessionAgentItem[] => {
  const list = [...items];
  const byTime = (a: SessionAgentItem, b: SessionAgentItem) =>
    (b.lastActiveAt || b.createdAt) - (a.lastActiveAt || a.createdAt);
  if (groupMode === 'project') {
    list.sort((a, b) => {
      const projectDiff = projectDisplayName(a.projectDir).localeCompare(projectDisplayName(b.projectDir));
      return projectDiff !== 0 ? projectDiff : byTime(a, b);
    });
    return list;
  }
  list.sort(byTime);
  return list;
};

/** 分组键：同一键的会话属于同一组。 */
export const sessionGroupKey = (item: SessionAgentItem, groupMode: string): string => {
  if (groupMode === 'project') {
    return projectDisplayName(item.projectDir) || '—';
  }
  const ts = item.lastActiveAt || item.createdAt;
  if (!ts) return 'older';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= today) return 'today';
  if (ts >= today - 86400000) return 'yesterday';
  if (ts >= today - 6 * 86400000) return 'week';
  return 'older';
};

/** 分组的显示名：按项目时是项目名，按时间时是时间段。 */
export const sessionGroupLabel = (item: SessionAgentItem, groupMode: string): string => {
  if (groupMode === 'project') {
    return projectDisplayName(item.projectDir) || '—';
  }
  switch (sessionGroupKey(item, groupMode)) {
    case 'today': return t('session_agent.group.today');
    case 'yesterday': return t('session_agent.group.yesterday');
    case 'week': return t('session_agent.group.week');
    default: return t('session_agent.group.older');
  }
};

/** 把会话按分组聚成组（组内按时间倒序）。 */
export const buildSessionGroups = (
  items: SessionAgentItem[],
  groupMode: string,
): SessionGroup[] => {
  const groups: SessionGroup[] = [];
  let current: SessionGroup | null = null;
  for (const item of sortSessionItems(items, groupMode)) {
    const key = sessionGroupKey(item, groupMode);
    if (!current || current.key !== key) {
      current = { key, label: sessionGroupLabel(item, groupMode), items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
};
