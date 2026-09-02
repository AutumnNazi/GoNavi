import { useEffect, useMemo, useRef } from 'react';

import { useStore } from '../../store';
import type { AIChatMessage } from '../../types';
import {
  getAIRunHarnessService,
  listAgentSessions,
  mergeAIChatSessionMessages,
  readAgentSession,
  toAIChatMessages,
} from './aiRunHarnessClient';

interface UseAIChatSessionStateOptions {
  aiActiveSessionId: string | null;
  aiPanelVisible: boolean;
  createNewAISession: () => void;
}

const EMPTY_AI_CHAT_MESSAGES: AIChatMessage[] = [];

export const useAIChatSessionState = ({
  aiActiveSessionId,
  aiPanelVisible,
  createNewAISession,
}: UseAIChatSessionStateOptions) => {
  const aiChatSessions = useStore((state) => state.aiChatSessions);
  const sid = aiActiveSessionId || 'session-fallback';
  const messages = useStore((state) => state.aiChatHistory[sid] || EMPTY_AI_CHAT_MESSAGES);

  useEffect(() => {
    if (!aiActiveSessionId) {
      createNewAISession();
    }
  }, [aiActiveSessionId, createNewAISession]);

  const sessionsLoadedRef = useRef(false);
  useEffect(() => {
    if (!aiPanelVisible || sessionsLoadedRef.current) {
      return;
    }
    const service = getAIRunHarnessService();
    if (!service?.AIListAgentSessions) return;
    sessionsLoadedRef.current = true;
    void listAgentSessions({ limit: 500 }, service).then((result) => {
      const sessions = (Array.isArray(result.sessions) ? result.sessions : []).map((session) => {
        const rawUpdatedAt = session.updatedAt;
        const parsedUpdatedAt = typeof rawUpdatedAt === 'number'
          ? rawUpdatedAt
          : Date.parse(String(rawUpdatedAt || ''));
        return {
          id: String(session.sessionId || session.id || '').trim(),
          title: String(session.title || '').trim(),
          updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now(),
          revision: Number(session.revision) || undefined,
          generation: Number(session.generation) || undefined,
          archived: Boolean(session.archived),
        };
      }).filter((session) => Boolean(session.id) && !session.archived)
        .map(({ archived: _archived, ...session }) => session);
      useStore.setState({ aiChatSessions: sessions });
    }).catch((error) => {
      console.warn('Failed to list AI agent sessions', error);
    });
  }, [aiPanelVisible]);

  useEffect(() => {
    if (!sid || sid === 'session-fallback') return;
    const service = getAIRunHarnessService();
    if (!service?.AIReadAgentSession) return;
    let disposed = false;
    void readAgentSession({ sessionId: sid, limit: 10_000 }, service).then((projection) => {
      if (disposed) return;
      const durable = toAIChatMessages(projection);
      useStore.setState((state) => ({
        aiChatHistory: {
          ...state.aiChatHistory,
          [sid]: mergeAIChatSessionMessages(durable, state.aiChatHistory[sid] || []),
        },
      }));
    }).catch(() => {
      // A local placeholder does not exist in the Ledger until its first input.
    });
    return () => {
      disposed = true;
    };
  }, [sid]);

  const orderedAISessions = useMemo(
    () => [...aiChatSessions].sort((left, right) => right.updatedAt - left.updatedAt),
    [aiChatSessions],
  );

  return {
    sid,
    messages,
    orderedAISessions,
  };
};
