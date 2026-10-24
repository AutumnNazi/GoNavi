import React from 'react';
import { SessionAgentMarkdown } from './SessionAgentMarkdown';
import { parseJsonMessage, type JsonMessageMetaRow, type JsonMessageView } from './sessionAgentJsonContent';
import { t } from '../../i18n';
import './SessionAgentJsonMessage.css';

/** 摘要行的展示值：数组/对象走 i18n 计数文案，标量取原值。 */
const metaValue = (row: JsonMessageMetaRow): string => {
  if (row.kind === 'array') {
    return t('session_agent.json.items_count', { count: row.count ?? 0 });
  }
  if (row.kind === 'object') {
    return t('session_agent.json.fields_count', { count: row.count ?? 0 });
  }
  return row.value ?? '';
};

/**
 * 短正文的阈值。子 Agent 的枚举值都很短（allow / blocked / ok），单独
 * 出现会丢失语义（只看到 "ok" 不知道是什么）；结论句都远超这个长度，
 * 不需要字段名。
 */
const SHORT_PROSE_CHARS = 24;

/**
 * 结构化 JSON 消息的展示。
 *
 * 正文按普通对话渲染（看不出原来是个 JSON），其余字段收成一行可展开的
 * 摘要行——枚举显示原值、数组显示条目数，展开后是原始内容，信息不丢。
 */
export const SessionAgentJsonMessage: React.FC<{
  view: JsonMessageView;
  /** 会话内搜索的命中高亮；null 表示没有搜索词。 */
  highlight?: ((text: string) => React.ReactNode) | null;
}> = ({ view, highlight }) => {
  const [open, setOpen] = React.useState(false);
  // 枚举值类的短正文带上字段名，避免只剩一个孤零零的 ok / allow。
  const labeled = view.proseField !== '' && view.prose.length < SHORT_PROSE_CHARS;
  const proseNode = !view.prose ? null : labeled ? (
    <div className="gn-session-agent-atext is-plain">
      <span className="gn-session-agent-jsonlabel-key">{view.proseField}</span>
      {highlight ? highlight(view.prose) : view.prose}
    </div>
  ) : highlight ? (
    <div className="gn-session-agent-atext is-plain">{highlight(view.prose)}</div>
  ) : (
    <div className="gn-session-agent-atext">
      <SessionAgentMarkdown content={view.prose} />
    </div>
  );
  return (
    <div className="gn-session-agent-json" data-session-agent-json="true">
      {proseNode}
      {view.meta.length > 0 ? (
        <div className="gn-session-agent-jsonmeta">
          <button
            type="button"
            className="gn-session-agent-jsonmeta-head"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <span className={`gn-session-agent-jsonmeta-caret${open ? ' open' : ''}`}>▶</span>
            {view.meta.map((row) => (
              <span className="gn-session-agent-jsonmeta-chip" key={row.key} data-json-key={row.key}>
                {row.key} {metaValue(row)}
              </span>
            ))}
          </button>
          {open ? (
            <div className="gn-session-agent-jsonmeta-body">
              {view.meta.map((row) => (
                <div className="gn-session-agent-jsonmeta-row" key={row.key}>
                  <span className="gn-session-agent-jsonmeta-key">{row.key}</span>
                  {row.detail ? (
                    <pre className="gn-session-agent-jsonmeta-detail">{row.detail}</pre>
                  ) : (
                    <span className="gn-session-agent-jsonmeta-value">{metaValue(row)}</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * 文本渲染入口：整段是 JSON 对象就按结构化消息展示，否则按普通文本。
 * 给工具结果预览用——工具输出里也有 2% 是纯 JSON。
 */
export const SessionAgentJsonText: React.FC<{
  text: string;
  className?: string;
}> = ({ text, className }) => {
  const view = React.useMemo(() => parseJsonMessage(text), [text]);
  if (!view) {
    return <pre className={className}>{text}</pre>;
  }
  return <SessionAgentJsonMessage view={view} />;
};
