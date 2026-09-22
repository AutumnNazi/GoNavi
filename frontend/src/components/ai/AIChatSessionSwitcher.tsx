import React from 'react';

import { useI18n } from '../../i18n/provider';
import { isAIRunTerminalState, type AIRunState } from './aiRunEventProjection';
import './AIChatSessionSwitcher.css';

export interface AIChatSessionSwitchItem {
  id: string;
  title: string;
}

export const collectBusyAISessionIds = (
  runs: Iterable<{ sessionId?: string; state?: string }>,
): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const sessionId = String(run.sessionId || '').trim();
    if (!sessionId || seen.has(sessionId) || (run.state && isAIRunTerminalState(run.state as AIRunState))) {
      continue;
    }
    seen.add(sessionId);
    ids.push(sessionId);
  }
  return ids;
};

interface AIChatSessionSwitcherProps {
  sessions: AIChatSessionSwitchItem[];
  activeSessionId: string;
  busySessionIds?: readonly string[];
  onSelectSession: (sessionId: string) => void;
}

const AIChatSessionSwitcher: React.FC<AIChatSessionSwitcherProps> = ({
  sessions,
  activeSessionId,
  busySessionIds = [],
  onSelectSession,
}) => {
  const { t } = useI18n();
  if (sessions.length < 2) {
    return null;
  }
  const busy = new Set(busySessionIds);
  const runningLabel = t('ai_chat.session_switcher.running');

  return (
    <div
      className="gn-ai-session-switcher"
      role="tablist"
      aria-label={t('ai_chat.session_switcher.aria_label')}
    >
      {sessions.map((session) => {
        const active = session.id === activeSessionId;
        const running = busy.has(session.id);
        const title = session.title || t('ai_chat.panel.session.default_title');
        return (
          <button
            key={session.id}
            type="button"
            role="tab"
            className={active ? 'is-active' : undefined}
            aria-selected={active}
            title={running ? `${title} · ${runningLabel}` : title}
            onClick={() => {
              if (!active) onSelectSession(session.id);
            }}
          >
            {running && <span className="gn-ai-session-switcher-dot" aria-hidden="true" />}
            <span>{title}</span>
          </button>
        );
      })}
    </div>
  );
};

export default AIChatSessionSwitcher;
