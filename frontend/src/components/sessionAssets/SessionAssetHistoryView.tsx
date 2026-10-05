import React from 'react';
import { Button, Empty, Spin } from 'antd';
import { t } from '../../i18n';
import type { SessionHistoryPage } from './sessionAssetsApi';

/**
 * 历史视图：以消息与轮次阅读，历史工具调用默认折叠可展开（交互设计
 * §5.2）；长历史按需分页加载，不整文件渲染（V-23）。
 */
export const SessionAssetHistoryView: React.FC<{
  page: SessionHistoryPage | null;
  loading: boolean;
  onLoadMore: () => void;
}> = ({ page, loading, onLoadMore }) => {
  if (!page && loading) {
    return <div className="session-assets-history-loading"><Spin /></div>;
  }
  if (!page || page.entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('session_assets.history.empty')} />;
  }
  return (
    <div className="session-assets-history" data-session-assets-history="true">
      {page.entries.map((entry) => (
        <HistoryEntryRow key={entry.index} entry={entry} />
      ))}
      {page.hasMore ? (
        <Button size="small" block loading={loading} onClick={onLoadMore} data-history-load-more="true">
          {t('session_assets.history.load_more')}
        </Button>
      ) : null}
    </div>
  );
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
