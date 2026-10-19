import React from 'react';
import { Button, Input, Modal, Spin, Tooltip, message } from 'antd';
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { t } from '../../i18n';
import type { SessionAgentItem, SessionBlockContent, SessionContentRef, SessionMessageView, SessionTurnView } from './sessionAgentApi';
import { ProviderAvatar } from './SessionAgentListPage';

/**
 * 会话详情页（挤压式）：列表收成左侧窄条，右侧聊天风格时间线。
 * 用户消息右侧气泡、助手消息左侧头像；工具调用收进「执行过程」
 * 折叠条；顶部统计条 + 全部/对话/改动视图切换；「最新」悬浮按钮。
 */
export const SessionAgentDetailPanel: React.FC<{
  item: SessionAgentItem;
  messages: SessionMessageView[];
  turns: SessionTurnView[];
  loading: boolean;
  onBack: () => void;
  onReload: () => void;
  onExport: () => void;
  onCopyResume: () => void;
  onDelete: () => void;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ item, messages, turns, loading, onBack, onReload, onExport, onCopyResume, onDelete, onOpenFull }) => {
  const [search, setSearch] = React.useState('');
  const [viewMode, setViewMode] = React.useState<'all' | 'chat' | 'changes'>('all');
  const [stats, setStats] = React.useState<{ questions: number; calls: number } | null>(null);

  if (loading) {
    return <div className="session-agent-detail-loading"><Spin /></div>;
  }

  const needle = search.trim().toLowerCase();
  const highlight = (text: string) => {
    if (!needle) return text;
    const idx = text.toLowerCase().indexOf(needle);
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
        <Button className="session-agent-back-btn" size="small" icon={<ArrowLeftOutlined />} onClick={onBack}>
          {t('session_agent.action.back_to_list')}
        </Button>
        <div className="session-agent-detail-titleline">
          <h3 className="session-agent-detail-title">{item.title || item.sessionId}</h3>
        </div>
        <div className="session-agent-detail-actions">
          <Tooltip title={t('session_agent.action.reload')}>
            <Button size="small" icon={<ReloadOutlined />} onClick={onReload} aria-label={t('session_agent.action.reload')} />
          </Tooltip>
          <Button size="small" icon={<CopyOutlined />} onClick={onCopyResume}>
            {t('session_agent.action.copy_resume')}
          </Button>
          <Button size="small" icon={<ExportOutlined />} onClick={onExport}>
            {t('session_agent.action.export')}
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete}>
            {t('session_agent.action.delete')}
          </Button>
        </div>
      </header>

      <div className="session-agent-detail-sub">
        <span className="session-agent-detail-meta">
          {item.projectDir || '—'} · {item.providerId === 'claude' ? 'Claude Code' : 'ChatGPT'}
          {stats ? ` · ${t('session_agent.detail.stats', { questions: stats.questions, calls: stats.calls })}` : ''}
        </span>
        <Input.Search
          allowClear
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('session_agent.detail.search_placeholder')}
          aria-label={t('session_agent.detail.search_placeholder')}
          style={{ maxWidth: 240 }}
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

      <Timeline
        item={item}
        messages={messages}
        turns={turns}
        viewMode={viewMode}
        needle={needle}
        highlight={highlight}
        onOpenFull={onOpenFull}
        onStats={setStats}
      />
    </section>
  );
};

// 时间线：按轮次渲染聊天流；滚动到底部跟随，离开底部出现「最新」按钮。
const Timeline: React.FC<{
  item: SessionAgentItem;
  messages: SessionMessageView[];
  turns: SessionTurnView[];
  viewMode: 'all' | 'chat' | 'changes';
  needle: string;
  highlight: (text: string) => React.ReactNode;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
  onStats: (stats: { questions: number; calls: number } | null) => void;
}> = ({ item, messages, turns, viewMode, needle, highlight, onOpenFull, onStats }) => {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  // 统计条数据：提问数与工具调用数。
  React.useEffect(() => {
    let questions = 0;
    let calls = 0;
    for (const msg of messages) {
      if (msg.role === 'user' && !msg.injected && msg.content.trim()) questions++;
      for (const block of msg.blocks ?? []) {
        if (block.type === 'tool_call') calls++;
      }
    }
    onStats({ questions, calls });
    return () => onStats(null);
  }, [messages, onStats]);

  // 切会话时回底部。
  React.useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [item.sourcePath]);

  const handleScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    setAtBottom(body.scrollHeight - body.scrollTop - body.clientHeight < 60);
  };

  const scrollToBottom = () => {
    const body = bodyRef.current;
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="session-agent-timeline" data-session-agent-timeline="true" ref={bodyRef} onScroll={handleScroll}>
      {turns.length === 0 ? (
        <div className="session-agent-detail-empty-body">
          <p>{t('session_agent.detail.empty')}</p>
        </div>
      ) : (
        turns.map((turn) => (
          <TurnSection
            key={turn.turnId + turn.firstMessageIndex}
            turn={turn}
            messages={messages}
            viewMode={viewMode}
            needle={needle}
            providerId={item.providerId}
            highlight={highlight}
            onOpenFull={onOpenFull}
          />
        ))
      )}
      {!atBottom && (
        <button type="button" className="session-agent-latest-btn" onClick={scrollToBottom}>
          ↓ {t('session_agent.detail.latest')}
        </button>
      )}
    </div>
  );
};

const TurnSection: React.FC<{
  turn: SessionTurnView;
  messages: SessionMessageView[];
  viewMode: 'all' | 'chat' | 'changes';
  needle: string;
  providerId: string;
  highlight: (text: string) => React.ReactNode;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ turn, messages, viewMode, needle, providerId, highlight, onOpenFull }) => {
  const slice = messages.slice(turn.firstMessageIndex, turn.lastMessageIndex + 1);
  return (
    <div className="session-agent-turn" data-session-agent-turn={turn.turnId}>
      {slice.map((msg, i) => (
        <MessageRow
          key={`${turn.turnId}-${i}`}
          msg={msg}
          viewMode={viewMode}
          needle={needle}
          providerId={providerId}
          highlight={highlight}
          onOpenFull={onOpenFull}
        />
      ))}
    </div>
  );
};

const MessageRow: React.FC<{
  msg: SessionMessageView;
  viewMode: 'all' | 'chat' | 'changes';
  needle: string;
  providerId: string;
  highlight: (text: string) => React.ReactNode;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ msg, viewMode, needle, providerId, highlight, onOpenFull }) => {
  if (msg.injected) return null;

  if (msg.role === 'user') {
    return (
      <div className="session-agent-msg-user">
        <span className="session-agent-msg-ts">{formatTs(msg.ts)}</span>
        <div className="session-agent-bubble-user">{highlight(msg.content)}</div>
      </div>
    );
  }
  if (msg.role === 'assistant') {
    const toolBlocks = (msg.blocks ?? []).filter((b) => b.type === 'tool_call' || b.type === 'tool_result');
    const textBlocks = (msg.blocks ?? []).filter((b) => b.type === 'text');
    const thinkingBlocks = (msg.blocks ?? []).filter((b) => b.type === 'thinking');
    const providerName = providerId === 'claude' ? 'Claude Code' : 'ChatGPT';
    return (
      <div className="session-agent-msg-assistant">
        <ProviderAvatar providerId={providerId} />
        <div className="session-agent-abody">
          <div className="session-agent-ahead">
            <span className="session-agent-aname">{providerName}</span>
            <span className="session-agent-ats">{formatTs(msg.ts)}</span>
          </div>
          {thinkingBlocks.map((block, i) => <ThinkingRow key={i} block={block} />)}
          {toolBlocks.length > 0 && (
            <ExecSection blocks={toolBlocks} onOpenFull={onOpenFull} />
          )}
          {msg.content ? <div className="session-agent-atext">{highlight(msg.content)}</div> : null}
          {textBlocks.map((block, i) => (
            block.text ? <div key={i} className="session-agent-atext">{highlight(block.text.text)}</div> : null
          ))}
        </div>
      </div>
    );
  }
  // tool / system：全部视图下以弱化行展示。
  if (viewMode === 'chat') return null;
  return (
    <div className="session-agent-msg-system">
      <span className="session-agent-msg-ts">{formatTs(msg.ts)}</span>
      <span className="session-agent-system-text">{msg.content}</span>
    </div>
  );
};

const ThinkingRow: React.FC<{ block: NonNullable<SessionMessageView['blocks']>[number] }> = ({ block }) => {
  if (!block.thinking) return null;
  return (
    <details className="session-agent-thinking">
      <summary>{t('session_agent.detail.thinking')}</summary>
      {block.thinking.redacted
        ? <span className="session-agent-thinking-redacted">{t('session_agent.detail.thinking_redacted')}</span>
        : <div className="session-agent-thinking-text">{block.thinking.text}</div>}
    </details>
  );
};

// 执行过程折叠条：默认收起显示步数，展开看工具序列。
const ExecSection: React.FC<{
  blocks: NonNullable<SessionMessageView['blocks']>;
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ blocks, onOpenFull }) => {
  const [open, setOpen] = React.useState(false);
  const calls = blocks.filter((b) => b.type === 'tool_call' && b.toolCall);
  const results = new Map<string, NonNullable<SessionMessageView['blocks']>[number]>();
  for (const b of blocks) {
    if (b.type === 'tool_result' && b.toolResult) results.set(b.toolResult.callId, b);
  }
  return (
    <div className={`session-agent-exec${open ? ' open' : ''}`}>
      <div className="session-agent-exec-head" onClick={() => setOpen(!open)} role="button" aria-expanded={open}>
        <span className={`session-agent-exec-caret${open ? ' open' : ''}`}>▶</span>
        <span className="session-agent-exec-title">
          {t('session_agent.detail.steps', { count: calls.length })}
        </span>
      </div>
      {open && (
        <div className="session-agent-exec-body">
          {calls.map((block, i) => (
            <ToolRow key={block.toolCall?.id ?? i} call={block.toolCall!} result={results.get(block.toolCall?.id ?? '')?.toolResult} onOpenFull={onOpenFull} />
          ))}
        </div>
      )}
    </div>
  );
};

const ToolRow: React.FC<{
  call: NonNullable<SessionMessageView['blocks']>[number]['toolCall'] & object;
  result?: NonNullable<SessionMessageView['blocks']>[number]['toolResult'];
  onOpenFull: (ref: SessionContentRef) => Promise<SessionBlockContent | null>;
}> = ({ call, result, onOpenFull }) => {
  const [open, setOpen] = React.useState(false);
  const status = result?.status ?? 'pending';
  return (
    <div className="session-agent-toolrow">
      <div className="session-agent-toolline" onClick={() => setOpen(!open)} role="button">
        <span className="session-agent-toolkind">{call.kind}</span>
        <span className="session-agent-tooltitle">{call.title}</span>
        {call.diff && <span className="session-agent-tooldiff">+{call.diff.added} -{call.diff.removed}</span>}
        <span className={`session-agent-toolstatus ${status}`}>{status === 'success' ? '✓' : status === 'error' ? '✗' : '…'}</span>
      </div>
      {open && call.inputPreview && (
        <pre className="session-agent-tooldetail">{call.inputPreview}</pre>
      )}
      {open && result?.preview && (
        <pre className="session-agent-tooldetail">{result.preview}</pre>
      )}
      {open && result?.truncated && result.full && <ExpandFull blockRef={result.full} onOpenFull={onOpenFull} />}
    </div>
  );
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
        onClick={async () => {
          const full = await onOpenFull(blockRef);
          if (full) setContent(full);
          else message.warning(t('session_agent.error.content_failed'));
        }}
      >
        {content ? t('session_agent.detail.collapse_full') : t('session_agent.detail.expand_full')}
      </Button>
      {content && <pre className="session-agent-tooldetail expanded">{content.text}</pre>}
    </>
  );
};

const formatTs = (ts: number): string => {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

// ─── 删除确认 ───
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
