import { useStore, type AIChatSessionSummary } from '../../store';

/** 新会话在账本列表刷新前先出现在聊天记录里，方便在多路诊断之间切换。 */
export const rememberLocalAIChatSession = (sessionId: string, title: string): void => {
  const id = sessionId.trim();
  if (!id) {
    return;
  }
  const nextTitle = title.trim().slice(0, 80);
  useStore.setState((state) => {
    const existing = state.aiChatSessions.find((session) => session.id === id);
    if (existing) {
      return {
        aiChatSessions: state.aiChatSessions.map((session) => (
          session.id === id
            ? { ...session, title: nextTitle || session.title, updatedAt: Date.now() }
            : session
        )),
      };
    }
    const created: AIChatSessionSummary = {
      id,
      title: nextTitle,
      updatedAt: Date.now(),
    };
    return { aiChatSessions: [created, ...state.aiChatSessions] };
  });
};
