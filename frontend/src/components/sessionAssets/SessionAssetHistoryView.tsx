import React from 'react';
import { Button, Empty, Spin } from 'antd';
import { t } from '../../i18n';
import type { SessionHistoryEntry, SessionHistoryPage } from './sessionAssetsApi';

/**
 * 历史视图：对话优先（交互设计 §5.2）。用户真实输入与助手回复为
 * 主线；工具调用按 callId 成对折叠；注入包装（环境上下文/指令）折叠
 * 为上下文块；事件默认隐藏可展开；长历史按需分页，不整文件渲染
 * （V-23）。
 */
export const SessionAssetHistoryView: React.FC<{
  page: SessionHistoryPage | null;
  loading: boolean;
  onLoadMore: () => void;
}> = ({ page, loading, onLoadMore }) => {
  const [showNoise, setShowNoise] = React.useState(false);
  if (!page && loading) {
    return <div className="session-assets-history-loading"><Spin /></div>;
  }
  if (!page || page.entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_assets.history.empty')} />;
  }
  // 对话优先：主线只留用户/助手消息与成对工具调用；包装与事件进折叠块。
  const primary = page.entries.filter(isPrimaryEntry);
  const noise = page.entries.filter((entry) => !isPrimaryEntry(entry));
  const groups = groupToolPairs(primary);
  return (
    <div className="session-assets-history" data-session-assets-history="true">
      {groups.map((group) =>
        group.output ? (
          <details
            key={group.call.index}
            className="session-assets-entry tool-group"
            data-history-kind="tool-group"
          >
            <summary>
              <span className="session-assets-entry-label">
                {entryLabel(group.call)}
                {group.output ? ` + ${entryLabel(group.output)}` : ''}
              </span>
            </summary>
            <pre className="session-assets-entry-text">
              {group.call.opaque ? t('session_assets.history.opaque') : group.call.text || '(empty)'}
              {'\n'}
              {group.output.opaque ? t('session_assets.history.opaque') : group.output.text || ''}
            </pre>
          </details>
        ) : (
          <HistoryEntryRow key={group.call.index} entry={group.call} />
        ),
      )}
      {page.hasMore ? (
        <Button size="small" block loading={loading} onClick={onLoadMore} data-history-load-more="true">
          {t('session_assets.history.load_more')}
        </Button>
      ) : null}
      {noise.length > 0 ? (
        <details className="session-assets-entry noise-block" data-history-kind="noise-block">
          <summary>
            <span className="session-assets-entry-label">
              {t('session_assets.history.noise_toggle', { count: noise.length })}
            </span>
          </summary>
          {noise.map((entry) => (
            <HistoryEntryRow key={entry.index} entry={entry} />
          ))}
        </details>
      ) : null}
    </div>
  );
};

/** 主线条目：真实用户输入、助手回复、成对工具调用。 */
const isPrimaryEntry = (entry: SessionHistoryPage['entries'][number]): boolean => {
  if (entry.wrapper) return false;
  if (entry.kind === 'message') return entry.role === 'user' || entry.role === 'assistant';
  return entry.kind === 'tool_call' || entry.kind === 'tool_output';
};

const HistoryEntryRow: React.FC<{ entry: SessionHistoryPage['entries'][number] }> = ({ entry }) => {
  const label = entryLabel(entry);
  if (entry.kind === 'tool_call' || entry.kind === 'tool_output') {
    return (
      <details className={`session-assets-entry ${entry.kind}`} data-history-kind={entry.kind}>
        <summary>
          <span className="session-assets-entry-label">{label}</span>
        </summary>
        <pre className="session-assets-entry-text">{entry.opaque ? t('session_assets.history.opaque') : entry.text || '(empty)'}</pre>
      </details>
    );
  }
  if (entry.kind === 'system' || entry.kind === 'event') {
    return (
      <div className={`session-assets-entry ${entry.kind}`} data-history-kind={entry.kind}>
        <span className="session-assets-entry-label">{label}</span>
        {entry.opaque ? <span className="session-assets-entry-text">{t('session_assets.history.opaque')}</span> : null}
      </div>
    );
  }
  return (
    <div className={`session-assets-entry ${entry.kind}`} data-history-kind={entry.kind}>
      <span className="session-assets-entry-label">{label}</span>
      <div className="session-assets-entry-text">
        {entry.opaque ? t('session_assets.history.opaque') : entry.text || '(empty)'}
      </div>
    </div>
  );
};

const entryLabel = (entry: SessionHistoryPage['entries'][number]): string => {
  switch (entry.kind) {
    case 'message':
      return t(`session_assets.history.role.${entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : 'system'}`);
    case 'tool_call':
    case 'tool_output':
      return t(entry.kind === 'tool_call' ? 'session_assets.history.tool_call' : 'session_assets.history.tool_output', {
        name: entry.name || entry.callId || '',
      });
    case 'reasoning':
      return t('session_assets.history.reasoning');
    case 'event':
      return t('session_assets.history.event', { name: entry.text || '' });
    case 'system':
      return t('session_assets.history.system');
    default:
      return t('session_assets.history.unknown');
  }
};

// groupToolPairs 把成对的工具调用与输出按 callId 关联为一组（交互设计
// §5.2）：output 紧随其 call 时合并渲染；未配对的条目单独渲染。
function groupToolPairs(entries: SessionHistoryPage['entries']): Array<{
  call: SessionHistoryPage['entries'][number];
  output?: SessionHistoryPage['entries'][number];
}> {
  const groups: Array<{
    call: SessionHistoryPage['entries'][number];
    output?: SessionHistoryPage['entries'][number];
  }> = [];
  let pending: SessionHistoryPage['entries'][number] | null = null;
  for (const entry of entries) {
    if (entry.kind === 'tool_call') {
      if (pending) groups.push({ call: pending });
      pending = entry;
      continue;
    }
    if (entry.kind === 'tool_output') {
      if (pending && (!entry.callId || !pending.callId || entry.callId === pending.callId)) {
        groups.push({ call: pending, output: entry });
      } else {
        if (pending) groups.push({ call: pending });
        groups.push({ call: entry });
      }
      pending = null;
      continue;
    }
    if (pending) {
      groups.push({ call: pending });
      pending = null;
    }
    groups.push({ call: entry });
  }
  if (pending) groups.push({ call: pending });
  return groups;
}
