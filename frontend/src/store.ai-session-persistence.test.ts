import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAIChatSessionPersistence, useStore } from './store';

describe('AI session persistence flush', () => {
  const saveSession = vi.fn();
  let previousWindowDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    saveSession.mockReset();
    saveSession.mockResolvedValue(undefined);
    previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { aiservice: undefined, go: { aiservice: { Service: { AISaveSession: saveSession } } } },
    });
    useStore.setState({
      aiChatHistory: {},
      aiChatSessions: [],
      aiActiveSessionId: null,
    });
  });

  afterEach(async () => {
    saveSession.mockResolvedValue(undefined);
    await flushAIChatSessionPersistence();
    vi.useRealTimers();
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('writes the latest pending session immediately and cancels its debounce timer', async () => {
    useStore.getState().addAIChatMessage('session-1', {
      id: 'message-1',
      role: 'user',
      content: 'latest message',
      timestamp: 1,
    });

    await flushAIChatSessionPersistence();

    expect(saveSession).toHaveBeenCalledOnce();
    expect(saveSession).toHaveBeenCalledWith(
      'session-1',
      expect.any(String),
      expect.any(Number),
      JSON.stringify(useStore.getState().aiChatHistory['session-1']),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveSession).toHaveBeenCalledOnce();
  });

  it('rejects a failed flush so the native window can remain open', async () => {
    useStore.getState().addAIChatMessage('session-2', {
      id: 'message-2',
      role: 'user',
      content: 'do not lose me',
      timestamp: 2,
    });
    saveSession.mockRejectedValueOnce(new Error('disk unavailable'));

    await expect(flushAIChatSessionPersistence()).rejects.toThrow('disk unavailable');
  });

  it('waits for an in-flight debounce write and then persists the newest snapshot', async () => {
    let resolveFirstWrite: (() => void) | undefined;
    saveSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    }));
    useStore.getState().addAIChatMessage('session-3', {
      id: 'message-3',
      role: 'assistant',
      content: 'partial',
      timestamp: 3,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(saveSession).toHaveBeenCalledOnce();

    useStore.getState().updateAIChatMessage('session-3', 'message-3', { content: 'complete' });
    const flushing = flushAIChatSessionPersistence();
    await Promise.resolve();
    expect(saveSession).toHaveBeenCalledOnce();

    resolveFirstWrite?.();
    await flushing;

    expect(saveSession).toHaveBeenCalledTimes(2);
    expect(saveSession.mock.calls[1][3]).toContain('complete');
  });

  it('keeps flushing until no newer generation appears during an immediate write', async () => {
    let resolveFirstWrite: (() => void) | undefined;
    saveSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    }));
    useStore.getState().addAIChatMessage('session-4', {
      id: 'message-4',
      role: 'assistant',
      content: 'partial',
      timestamp: 4,
    });

    const flushing = flushAIChatSessionPersistence();
    await Promise.resolve();
    expect(saveSession).toHaveBeenCalledOnce();
    useStore.getState().updateAIChatMessage('session-4', 'message-4', { content: 'final token' });
    resolveFirstWrite?.();
    await flushing;

    expect(saveSession).toHaveBeenCalledTimes(2);
    expect(saveSession.mock.calls[1][3]).toContain('final token');
  });
});
