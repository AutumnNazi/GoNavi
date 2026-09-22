import { describe, expect, it } from 'vitest';

import { useStore } from '../../store';
import { rememberLocalAIChatSession } from './rememberLocalAIChatSession';

describe('rememberLocalAIChatSession', () => {
  it('keeps separately diagnosed sessions side by side', () => {
    useStore.setState({ aiChatSessions: [] });

    rememberLocalAIChatSession('session-a', 'demo · table missing');
    rememberLocalAIChatSession('session-b', 'orders · syntax error');

    expect(useStore.getState().aiChatSessions.map((session) => session.id)).toEqual([
      'session-b',
      'session-a',
    ]);
  });

  it('refreshes the title of a session that is already listed', () => {
    useStore.setState({
      aiChatSessions: [{ id: 'session-a', title: 'old', updatedAt: 1 }],
    });

    rememberLocalAIChatSession('session-a', 'demo · table missing');

    expect(useStore.getState().aiChatSessions).toEqual([
      expect.objectContaining({ id: 'session-a', title: 'demo · table missing' }),
    ]);
  });
});
