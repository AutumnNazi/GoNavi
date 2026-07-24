import React from 'react';
import { DatabaseOutlined, HistoryOutlined, TableOutlined, WarningOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';

export type AIChatPanelMode = 'chat' | 'insights' | 'history';

export interface AIChatInsightItem {
  tone: 'info' | 'accent' | 'warn';
  title: string;
  body: string;
}

export interface AIChatInlineHistorySession {
  id: string;
  title: string;
  updatedAt: number;
}

interface AIChatPanelModeContentProps {
  mode: AIChatPanelMode;
  insights: AIChatInsightItem[];
  sessions: AIChatInlineHistorySession[];
  activeSessionId: string;
  sessionActionsDisabled?: boolean;
  onSelectSession: (sessionId: string) => void;
}

const renderInsightIcon = (tone: AIChatInsightItem['tone']) => {
  if (tone === 'warn') {
    return <WarningOutlined />;
  }
  if (tone === 'accent') {
    return <DatabaseOutlined />;
  }
  return <TableOutlined />;
};

const AIChatPanelModeContent: React.FC<AIChatPanelModeContentProps> = ({
  mode,
  insights,
  sessions,
  activeSessionId,
  sessionActionsDisabled = false,
  onSelectSession,
}) => {
  const { t } = useI18n();

  if (mode === 'insights') {
    return (
      <div className="gn-v2-ai-insights-list">
        {insights.map((item) => (
          <div className={`gn-v2-ai-insight-card tone-${item.tone}`} key={item.title}>
            <span className="gn-v2-ai-insight-icon">{renderInsightIcon(item.tone)}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (mode === 'history') {
    if (sessions.length === 0) {
      return (
        <div className="gn-v2-ai-history-list">
          <div className="gn-v2-ai-empty-note">{t('ai_chat.panel.history.empty')}</div>
        </div>
      );
    }

    return (
      <div className="gn-v2-ai-history-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={`gn-v2-ai-history-card${session.id === activeSessionId ? ' is-active' : ''}`}
            disabled={sessionActionsDisabled}
            onClick={() => onSelectSession(session.id)}
          >
            <span>
              <HistoryOutlined />
              <strong>{session.title || t('ai_chat.panel.session.default_title')}</strong>
            </span>
            <small>
              {new Date(session.updatedAt).toLocaleString(undefined, {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          </button>
        ))}
      </div>
    );
  }

  return null;
};

export default AIChatPanelModeContent;
