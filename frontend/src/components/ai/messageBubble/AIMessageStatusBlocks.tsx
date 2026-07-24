import React, { useEffect, useState } from 'react';
import { ApiOutlined, CaretDownOutlined, CaretRightOutlined, CheckOutlined } from '@ant-design/icons';

import { t as catalogTranslate } from '../../../i18n/catalog';
import type { I18nParams } from '../../../i18n/types';
import { useOptionalI18n } from '../../../i18n/provider';
import type { AIChatMessage, AIToolCall } from '../../../types';
import type { OverlayWorkbenchTheme } from '../../../utils/overlayWorkbenchTheme';
import type { AIToolResultIndex } from '../aiToolResultIndex';

interface AIThinkingBlockProps {
  displayThinking: string;
  isTyping: boolean;
  isGlobalLoading: boolean;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  hasContent: boolean;
}

interface AIToolCallingBlockProps {
  toolCalls: AIToolCall[];
  loading: boolean;
  toolResultsById: AIToolResultIndex;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  hasContent: boolean;
}

const useMessageCopy = () => {
  const i18n = useOptionalI18n();
  return (key: string, params?: I18nParams) => (
    i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams))
  )(key, params);
};

const TOOL_ACTION_LABEL_KEYS: Record<string, string> = {
  inspect_ai_runtime: 'ai_chat.message.tool_call.inspect_ai_runtime',
  inspect_ai_safety: 'ai_chat.message.tool_call.inspect_ai_safety',
  inspect_ai_providers: 'ai_chat.message.tool_call.inspect_ai_providers',
  inspect_ai_chat_readiness: 'ai_chat.message.tool_call.inspect_ai_chat_readiness',
  inspect_ai_tool_catalog: 'ai_chat.message.tool_call.inspect_ai_tool_catalog',
  inspect_ai_support_bundle: 'ai_chat.message.tool_call.inspect_ai_support_bundle',
  inspect_mcp_setup: 'ai_chat.message.tool_call.inspect_mcp_setup',
  inspect_mcp_runtime_failures: 'ai_chat.message.tool_call.inspect_mcp_runtime_failures',
  inspect_mcp_authoring_guide: 'ai_chat.message.tool_call.inspect_mcp_authoring_guide',
  inspect_mcp_draft: 'ai_chat.message.tool_call.inspect_mcp_draft',
  inspect_mcp_tool_schema: 'ai_chat.message.tool_call.inspect_mcp_tool_schema',
  inspect_ai_guidance: 'ai_chat.message.tool_call.inspect_ai_guidance',
  get_connections: 'ai_chat.message.tool_call.get_connections',
  get_databases: 'ai_chat.message.tool_call.get_databases',
  get_objects: 'ai_chat.message.tool_call.get_objects',
  get_tables: 'ai_chat.message.tool_call.get_tables',
  get_views: 'ai_chat.message.tool_call.get_views',
  get_all_columns: 'ai_chat.message.tool_call.get_all_columns',
  get_columns: 'ai_chat.message.tool_call.get_columns',
  get_indexes: 'ai_chat.message.tool_call.get_indexes',
  get_foreign_keys: 'ai_chat.message.tool_call.get_foreign_keys',
  get_triggers: 'ai_chat.message.tool_call.get_triggers',
  get_table_ddl: 'ai_chat.message.tool_call.get_table_ddl',
  inspect_table_bundle: 'ai_chat.message.tool_call.inspect_table_bundle',
  inspect_database_bundle: 'ai_chat.message.tool_call.inspect_database_bundle',
  inspect_current_connection: 'ai_chat.message.tool_call.inspect_current_connection',
  inspect_connection_capabilities: 'ai_chat.message.tool_call.inspect_connection_capabilities',
  inspect_saved_connections: 'ai_chat.message.tool_call.inspect_saved_connections',
  inspect_redis_topology: 'ai_chat.message.tool_call.inspect_redis_topology',
  inspect_external_sql_directories: 'ai_chat.message.tool_call.inspect_external_sql_directories',
  inspect_external_sql_file: 'ai_chat.message.tool_call.inspect_external_sql_file',
  inspect_ai_sessions: 'ai_chat.message.tool_call.inspect_ai_sessions',
  inspect_active_tab: 'ai_chat.message.tool_call.inspect_active_tab',
  inspect_workspace_tabs: 'ai_chat.message.tool_call.inspect_workspace_tabs',
  inspect_recent_sql_logs: 'ai_chat.message.tool_call.inspect_recent_sql_logs',
  inspect_recent_sql_activity: 'ai_chat.message.tool_call.inspect_recent_sql_activity',
  inspect_sql_editor_transaction: 'ai_chat.message.tool_call.inspect_sql_editor_transaction',
  inspect_app_logs: 'ai_chat.message.tool_call.inspect_app_logs',
  inspect_recent_connection_failures: 'ai_chat.message.tool_call.inspect_recent_connection_failures',
  inspect_ai_last_render_error: 'ai_chat.message.tool_call.inspect_ai_last_render_error',
  inspect_ai_message_flow: 'ai_chat.message.tool_call.inspect_ai_message_flow',
  inspect_ai_context_budget: 'ai_chat.message.tool_call.inspect_ai_context_budget',
  inspect_codebase_hotspots: 'ai_chat.message.tool_call.inspect_codebase_hotspots',
  inspect_saved_queries: 'ai_chat.message.tool_call.inspect_saved_queries',
  inspect_sql_snippets: 'ai_chat.message.tool_call.inspect_sql_snippets',
  inspect_shortcuts: 'ai_chat.message.tool_call.inspect_shortcuts',
  preview_table_rows: 'ai_chat.message.tool_call.preview_table_rows',
  execute_sql: 'ai_chat.message.tool_call.execute_sql',
};

const AIToolResultItem: React.FC<{ resultMsg: AIChatMessage; darkMode: boolean; overlayTheme: OverlayWorkbenchTheme }> = ({ resultMsg, darkMode, overlayTheme }) => {
  const [toolExpanded, setToolExpanded] = useState(false);
  const charCount = resultMsg.content ? resultMsg.content.length : 0;
  const copy = useMessageCopy();

  return (
    <div style={{
      background: darkMode ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.02)',
      borderRadius: 6,
      padding: '6px 10px',
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
      marginTop: 8,
      width: '100%',
    }}>
      <div
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 6, fontSize: 12, color: overlayTheme.mutedText }}
        onClick={() => setToolExpanded((prev) => !prev)}
      >
        {toolExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        <ApiOutlined style={{ color: '#1677ff' }} />
        <span>{copy('ai_chat.message.tool_result.title', { name: resultMsg.tool_name || 'unknown' })}</span>
        <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.6 }}>
          {charCount > 0 ? copy('ai_chat.message.tool_result.char_count', { count: charCount }) : copy('ai_chat.message.tool_result.no_data')}
        </span>
      </div>
      {toolExpanded && (
        <div style={{ marginTop: 8, fontSize: 12, color: overlayTheme.mutedText, fontFamily: 'var(--gn-font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto', background: darkMode ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)', padding: 8, borderRadius: 6 }}>
          {resultMsg.content}
        </div>
      )}
    </div>
  );
};

export const AIThinkingBlock: React.FC<AIThinkingBlockProps> = ({
  displayThinking,
  isTyping,
  isGlobalLoading,
  darkMode,
  overlayTheme,
  hasContent,
}) => {
  const isActivelyThinking = isGlobalLoading && !hasContent;
  const [expanded, setExpanded] = useState(isActivelyThinking);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const copy = useMessageCopy();

  useEffect(() => {
    if (isActivelyThinking) {
      setExpanded(true);
    }
  }, [isActivelyThinking]);

  useEffect(() => {
    if (!isGlobalLoading) {
      setExpanded(false);
    }
  }, [isGlobalLoading]);

  useEffect(() => {
    if (expanded && isTyping && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayThinking, expanded, isTyping]);

  return (
    <div style={{
      marginBottom: hasContent ? 8 : 0,
      borderRadius: 6,
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          cursor: 'pointer',
          background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
          fontSize: 12,
          color: overlayTheme.mutedText,
          userSelect: 'none',
        }}
      >
        <span style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 10 }}>▶</span>
        <span>💭 {copy('ai_chat.message.thinking.title')}</span>
        {isActivelyThinking && <span style={{ fontSize: 10, color: '#8b5cf6', animation: 'pulse 1.5s ease-in-out infinite' }}>{copy('ai_chat.message.thinking.active')}</span>}
        {!isActivelyThinking && <span style={{ fontSize: 10, opacity: 0.5 }}>{copy('ai_chat.message.thinking.count', { count: displayThinking.length })}</span>}
      </div>
      <div className={`ai-expand-transition ${expanded ? 'expanded' : 'collapsed'}`}>
        <div ref={contentRef} style={{
          padding: expanded ? '8px 12px' : '0 12px',
          borderLeft: '3px solid #8b5cf6',
          margin: '0 8px 8px',
          fontSize: 12,
          lineHeight: 1.7,
          color: overlayTheme.mutedText,
          fontStyle: 'italic',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 400,
          overflowY: 'auto',
        }}>
          {displayThinking}
          {isTyping && <span className="ai-blinking-cursor" style={{ background: '#8b5cf6', marginLeft: 4, width: 6, height: 12, display: 'inline-block', verticalAlign: 'middle', opacity: 0.8 }} />}
        </div>
      </div>
    </div>
  );
};

export const AIToolCallingBlock: React.FC<AIToolCallingBlockProps> = ({
  toolCalls,
  loading,
  toolResultsById,
  darkMode,
  overlayTheme,
  hasContent,
}) => {
  const copy = useMessageCopy();
  const allDone = toolCalls.every((toolCall) => toolResultsById.has(toolCall.id));
  const [expanded, setExpanded] = useState(!allDone && loading);

  useEffect(() => {
    if (allDone || !loading) {
      setExpanded(false);
    }
  }, [allDone, loading]);

  return (
    <div style={{
      background: darkMode ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.025)',
      borderRadius: 8,
      fontSize: 12,
      overflow: 'hidden',
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
      marginTop: hasContent ? 12 : 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          background: darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: overlayTheme.titleText, fontWeight: 500 }}>
          {!allDone && loading ? (
            <div className="ai-spinning-ring" />
          ) : (
            <CheckOutlined style={{ color: '#10b981' }} />
          )}
          <span>{!allDone && loading ? copy('ai_chat.message.tool_call.running') : copy('ai_chat.message.tool_call.done', { count: toolCalls.length })}</span>
        </div>
        <span style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 10, color: overlayTheme.mutedText }}>▶</span>
      </div>
      <div className={`ai-expand-transition ${expanded ? 'expanded' : 'collapsed'}`}>
        <div style={{ padding: expanded ? '4px 12px 12px' : '0 12px' }}>
          {toolCalls.map((toolCall) => {
            const resultMsg = toolResultsById.get(toolCall.id);
            const isDone = Boolean(resultMsg);
            const actionKey = TOOL_ACTION_LABEL_KEYS[toolCall.function.name];
            const translatedActionName = actionKey ? copy(actionKey) : '';
            const actionName = translatedActionName && translatedActionName !== actionKey ? translatedActionName : toolCall.function.name;
            return (
              <div key={toolCall.id} style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                marginTop: 6,
                paddingLeft: 8,
                borderLeft: `2px solid ${isDone ? '#10b981' : (loading ? '#1677ff' : overlayTheme.shellBorder)}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isDone
                    ? <CheckOutlined style={{ color: '#10b981', fontSize: 11 }} />
                    : (loading ? <div className="ai-spinning-ring" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : <ApiOutlined style={{ color: overlayTheme.mutedText, fontSize: 11 }} />)}
                  <span style={{ color: isDone ? overlayTheme.mutedText : overlayTheme.titleText }}>{actionName}</span>
                </div>
                {resultMsg && <AIToolResultItem resultMsg={resultMsg} darkMode={darkMode} overlayTheme={overlayTheme} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
