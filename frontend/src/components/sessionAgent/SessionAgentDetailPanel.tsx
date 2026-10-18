import React from 'react';
import { Alert, Button, Input, Modal, Spin, Tooltip, message } from 'antd';
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileTextOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAgentItem, SessionBlockContent, SessionContentRef, SessionMessageView, SessionTurnView } from './sessionAgentApi';

/**
 * 会话详情面板：按轮次分组渲染时间线（提问-回复），工具调用/结果折叠
 * 展示，大内容按需展开（ContentRef 分页）。信息架构照抄 cc-switch 会话
 * 阅读页，视觉走 GoNavi v2 主题。
 */
export const SessionAgentDetailPanel: React.FC<{
  item: SessionAgentItem | null;
  messages: SessionMessageView[];
  turns: SessionTurnView[];
  loading: boolean;
  onBackToList: () => void;
  onReload: () => void;
  onExportMarkdown: () => void;
  onCopyResume: () => void;
  onDelete: () => void;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ item, messages, turns, loading, onBackToList, onReload, onExportMarkdown, onCopyResume, onDelete, onOpenFull }) => {
  const [search, setSearch] = React.useState('');
  const [viewMode, setViewMode] = React.useState<'all' | 'chat' | 'changes'>('all');
  const [openTools, setOpenTools] = React.useState<Record<string, boolean>>({});

  if (loading || !item) {
    return <div className="session-agent-detail-loading"><Spin /></div>;
  }
  const needle = search.trim().toLowerCase();
  const highlight = (text: string) => {
    if (!needle) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark>{text.slice(idx, idx + needle.length)}</mark>
        {text.slice(idx + needle.length)}
      </>
    );
  };

  return (
    <section className="session-agent-detail" data-session-agent-detail="true">
      <header className="session-agent-detail-head">
        <div className="session-agent-detail-titleline">
          <h3 className="session-agent-detail-title">{item.title || item.sessionId}</h3>
          <span className="session-agent-detail-meta">
            {(item.projectDir || '—') + ' · ' + (item.providerId === 'claude' ? 'Claude' : 'ChatGPT')}
          </span>
        </div>
        <div className="session-agent-detail-actions">
          <Button className="session-agent-back-btn" size="small" icon={<ArrowLeftOutlined />} onClick={onBackToList}>
            {t('session_agent.action.back_to_list')}
          </Button>
          <Tooltip title={t('session_agent.action.reload')}>
            <Button size="small" icon={<ReloadOutlined />} onClick={onReload} aria-label={t('session_agent.action.reload')} />
          </Tooltip>
          <Button size="small" icon={<ExportOutlined />} onClick={onExportMarkdown}>
            {t('session_agent.action.export')}
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={onCopyResume}>
            {t('session_agent.action.copy_resume')}
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete}>
            {t('session_agent.action.delete')}
          </Button>
        </div>
      </header>

      <div className="session-agent-detail-toolbar">
        <Input.Search
          allowClear
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('session_agent.detail.search_placeholder')}
          aria-label={t('session_agent.detail.search_placeholder')}
          style={{ maxWidth: 280 }}
        />
        <div className="session-agent-detail-views">
          {(['all', 'chat', 'changes'] as const).map((mode) => (
            <Button
              key={mode}
              size="small"
              type={viewMode === mode ? 'primary' : 'default'}
              onClick={() => setViewMode(mode)}
            >
              {mode === 'all' ? t('session_agent.detail.view_all')
                : mode === 'chat' ? t('session_agent.detail.view_chat')
                  : t('session_agent.detail.view_changes')}
            </Button>
          ))}
        </div>
      </div>

      <div className="session-agent-timeline" data-session-agent-timeline="true">
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          turns.map((turn) => (
            <TurnSection
              key={turn.turnId + turn.firstMessageIndex}
              turn={turn}
              messages={messages}
              viewMode={viewMode}
              needle={needle}
              openTools={openTools}
              onToggleTool={(id) => setOpenTools((prev) => ({ ...prev, [id]: !prev[id] }))}
              highlight={highlight}
              onOpenFull={onOpenFull}
            />
          ))
        )}
      </div>
    </section>
  );
};

const EmptyState: React.FC = () => (
  <div className="session-agent-detail-empty-body">
    <Alert type="info" showIcon message={t('session_agent.detail.empty')} />
  </div>
);

const TurnSection: React.FC<{
  turn: SessionTurnView;
  messages: SessionMessageView[];
  viewMode: 'all' | 'chat' | 'changes';
  needle: string;
  openTools: Record<string, boolean>;
  onToggleTool: (id: string) => void;
  highlight: (text: string) => React.ReactNode;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ turn, messages, viewMode, needle, openTools, onToggleTool, highlight, onOpenFull }) => {
  const slice = messages.slice(turn.firstMessageIndex, turn.lastMessageIndex + 1);
  return (
    <section className="session-agent-turn" data-session-agent-turn={turn.turnId}>
      <header className="session-agent-turn-head">
        <span className="session-agent-turn-title">{turn.questionPreview || t('session_agent.detail.turn')}</span>
        <span className="session-agent-turn-stats">
          {turn.stepCount > 0 && <span>{t('session_agent.detail.steps', { count: turn.stepCount })}</span>}
          {turn.errorCount > 0 && <span className="session-agent-turn-error">{t('session_agent.detail.errors', { count: turn.errorCount })}</span>}
          {turn.aborted && <span>{t('session_agent.detail.aborted')}</span>}
        </span>
      </header>
      {slice.map((msg, i) => (
        <MessageRow
          key={`${turn.turnId}-${i}`}
          msg={msg}
          viewMode={viewMode}
          needle={needle}
          openTools={openTools}
          onToggleTool={onToggleTool}
          highlight={highlight}
          onOpenFull={onOpenFull}
        />
      ))}
    </section>
  );
};

const MessageRow: React.FC<{
  msg: SessionMessageView;
  viewMode: 'all' | 'chat' | 'changes';
  needle: string;
  openTools: Record<string, boolean>;
  onToggleTool: (id: string) => void;
  highlight: (text: string) => React.ReactNode;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ msg, viewMode, openTools, onToggleTool, highlight, onOpenFull }) => {
  if (msg.injected) {
    return (
      <div className="session-agent-entry injected" data-session-agent-injected="true">
        <span className="session-agent-entry-label">{t('session_agent.detail.injected')}</span>
      </div>
    );
  }
  const isChat = msg.role === 'user' || msg.role === 'assistant';
  if (viewMode === 'chat' && !isChat) return null;

  return (
    <div className={`session-agent-entry ${msg.role}`}>
      <span className="session-agent-entry-label">
        {msg.role === 'user' ? t('session_agent.detail.user')
          : msg.role === 'assistant' ? t('session_agent.detail.assistant')
            : msg.role === 'tool' ? t('session_agent.detail.tool')
              : t('session_agent.detail.system')}
      </span>
      {msg.content ? (
        <p className="session-agent-entry-text">{highlight(msg.content)}</p>
      ) : null}
      {(msg.blocks ?? []).map((block, idx) => (
        <BlockRow
          key={idx}
          block={block}
          viewMode={viewMode}
          openTools={openTools}
          onToggleTool={onToggleTool}
          onOpenFull={onOpenFull}
        />
      ))}
    </div>
  );
};

const BlockRow: React.FC<{
  block: NonNullable<SessionMessageView['blocks']>[number];
  viewMode: 'all' | 'chat' | 'changes';
  openTools: Record<string, boolean>;
  onToggleTool: (id: string) => void;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ block, viewMode, openTools, onToggleTool, onOpenFull }) => {
  if (block.type === 'thinking' && block.thinking) {
    return (
      <details className="session-agent-thinking" data-session-agent-thinking="true">
        <summary>{t('session_agent.detail.thinking')}</summary>
        {block.thinking.redacted
          ? <span className="session-agent-entry-label">{t('session_agent.detail.thinking_redacted')}</span>
          : <p className="session-agent-entry-text">{block.thinking.text}</p>}
      </details>
    );
  }
  if (block.type === 'tool_call' && block.toolCall) {
    const call = block.toolCall;
    const open = openTools[call.id] ?? false;
    return (
      <div className="session-agent-tool" data-session-agent-tool="true">
        <button type="button" className="session-agent-tool-head" onClick={() => onToggleTool(call.id)}>
          <span className="session-agent-tool-kind">{call.kind}</span>
          <span className="session-agent-tool-title">{call.title}</span>
          {call.diff && (
            <span className="session-agent-tool-diff">
              {`+${call.diff.added} -${call.diff.removed}`}
            </span>
          )}
          <span className="session-agent-tool-toggle">{open ? '▾' : '▸'}</span>
        </button>
        {open && call.inputPreview && (
          <pre className="session-agent-tool-input">{call.inputPreview}</pre>
        )}
        {open && call.diff && call.diff.files.length > 0 && (
          <ul className="session-agent-tool-files">
            {call.diff.files.map((file) => (
              <li key={file.path}>{file.op} · {file.path} (+{file.added} -{file.removed})</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (block.type === 'tool_result' && block.toolResult) {
    const result = block.toolResult;
    return (
      <div className="session-agent-tool-result" data-session-agent-tool-result="true">
        <span className={`session-agent-tool-status ${result.status}`}>{result.status}</span>
        {result.preview && <pre className="session-agent-tool-output">{result.preview}</pre>}
        {result.truncated && result.full && (
          <ExpandFull blockRef={result.full} onOpenFull={onOpenFull} />
        )}
      </div>
    );
  }
  if (block.type === 'text' && block.text) {
    return <p className="session-agent-entry-text">{block.text.text}</p>;
  }
  if (block.type === 'event' && block.event) {
    return (
      <div className="session-agent-event">
        <span className="session-agent-event-kind">{block.event.kind}</span>
        {block.event.text && <span>{block.event.text}</span>}
      </div>
    );
  }
  return null;
};

const ExpandFull: React.FC<{
  blockRef: SessionContentRef;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ blockRef, onOpenFull }) => {
  const [content, setContent] = React.useState<SessionBlockContent | null>(null);
  return (
    <>
      <Button
        size="small"
        type="link"
        icon={<FileTextOutlined />}
        onClick={async () => {
          const full = await onOpenFull(blockRef);
          setContent(full);
          if (!full) message.warning(t('session_agent.error.content_failed'));
        }}
      >
        {t('session_agent.detail.expand_full')}
      </Button>
      {content && <pre className="session-agent-tool-output expanded">{content.text}</pre>}
    </>
  );
};

// ─── 删除确认（复用 Modal.confirm 模式） ───
export const confirmSessionAgentDelete = (item: SessionAgentItem, onConfirm: () => void) => {
  Modal.confirm({
    title: t('session_agent.delete.title'),
    content: (
      <div data-session-agent-delete-confirm="true">
        <p>{t('session_agent.delete.body', { title: item.title || item.sessionId })}</p>
        <ul>
          <li>{t('session_agent.delete.scope_file')}</li>
          <li>{t('session_agent.delete.scope_no_restore')}</li>
        </ul>
      </div>
    ),
    okText: t('session_agent.action.delete'),
    okButtonProps: { danger: true },
    cancelText: t('common.cancel'),
    onOk: onConfirm,
  });
};
