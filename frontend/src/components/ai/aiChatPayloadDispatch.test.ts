import { afterEach, describe, expect, it, vi } from 'vitest';

import { t as translateCatalog } from '../../i18n';
import { dispatchAIChatPayload } from './aiChatPayloadDispatch';

describe('aiChatPayloadDispatch', () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('prefers streaming when AIChatStream is available', async () => {
    const AIChatStream = vi.fn().mockResolvedValue(undefined);
    const addAIChatMessage = vi.fn();
    const setSending = vi.fn();

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatStream },
        },
      },
    };

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-stream',
    });

    expect(result).toBe('stream');
    expect(AIChatStream).toHaveBeenCalledWith('session-1', [{ role: 'user', content: 'hello' }], []);
    expect(addAIChatMessage).not.toHaveBeenCalled();
    expect(setSending).not.toHaveBeenCalled();
  });

  it('prefers streaming with options and forwards the normalized request overrides', async () => {
    const AIChatStreamWithOptions = vi.fn().mockResolvedValue(undefined);
    const AIChatStream = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatStreamWithOptions, AIChatStream },
        },
      },
    };

    await dispatchAIChatPayload({
      sid: 'session-options',
      messages: [{ role: 'user', content: 'continue' }],
      tools: [],
      sendOptions: {
        model: '  glm-test  ',
        thinkingIntensity: ' high ',
        temperature: 0,
        maxTokens: 4096,
      },
      addAIChatMessage: vi.fn(),
      setSending: vi.fn(),
      nextMessageId: () => 'msg-options',
    });

    expect(AIChatStreamWithOptions).toHaveBeenCalledWith(
      'session-options',
      [{ role: 'user', content: 'continue' }],
      [],
      {
        model: 'glm-test',
        thinkingIntensity: 'high',
        temperature: 0,
        maxTokens: 4096,
      },
    );
    expect(AIChatStream).not.toHaveBeenCalled();
  });

  it('appends a non-stream assistant message when session-aware send is available', async () => {
    const AIChatSendInSession = vi.fn().mockResolvedValue({
      success: true,
      content: 'done',
      reasoning_content: 'thinking',
    });
    const addAIChatMessage = vi.fn();
    const setSending = vi.fn();
    const onNonStreamSuccess = vi.fn();

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatSendInSession },
        },
      },
    };

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-send',
      onNonStreamSuccess,
    });

    expect(result).toBe('send');
    expect(AIChatSendInSession).toHaveBeenCalledWith('session-1', [{ role: 'user', content: 'hello' }], []);
    expect(addAIChatMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
      id: 'msg-send',
      role: 'assistant',
      content: 'done',
      thinking: 'thinking',
      reasoning_content: 'thinking',
    }));
    expect(setSending).toHaveBeenCalledWith(false);
    expect(onNonStreamSuccess).toHaveBeenCalled();
  });

  it('settles the pending assistant message when falling back to non-stream send', async () => {
    const AIChatSendInSession = vi.fn().mockResolvedValue({
      success: true,
      content: 'done',
      reasoning_content: 'thinking',
    });
    const addAIChatMessage = vi.fn();
    const updateAIChatMessage = vi.fn();
    const setSending = vi.fn();

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatSendInSession },
        },
      },
    };

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      updateAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-send',
      pendingAssistantMessageId: 'assistant-connecting',
    });

    expect(result).toBe('send');
    expect(AIChatSendInSession).toHaveBeenCalledWith('session-1', [{ role: 'user', content: 'hello' }], []);
    expect(addAIChatMessage).not.toHaveBeenCalled();
    expect(updateAIChatMessage).toHaveBeenCalledWith('session-1', 'assistant-connecting', expect.objectContaining({
      content: 'done',
      thinking: 'thinking',
      reasoning_content: 'thinking',
      loading: false,
      phase: 'idle',
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('falls back to stateless AIChatSend when session-aware send is unavailable', async () => {
    const AIChatSend = vi.fn().mockResolvedValue({
      success: true,
      content: 'done',
      reasoning_content: 'thinking',
    });
    const addAIChatMessage = vi.fn();
    const setSending = vi.fn();

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatSend },
        },
      },
    };

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-send',
    });

    expect(result).toBe('send');
    expect(AIChatSend).toHaveBeenCalledWith([{ role: 'user', content: 'hello' }], []);
    expect(addAIChatMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
      id: 'msg-send',
      role: 'assistant',
      content: 'done',
      thinking: 'thinking',
      reasoning_content: 'thinking',
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('emits the unavailable message when the AI service is missing', async () => {
    const addAIChatMessage = vi.fn();
    const setSending = vi.fn();
    const unavailableContent = translateCatalog('ai_chat.panel.message.service_not_ready', undefined, 'zh-CN');
    (globalThis as any).window = {};

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-unavailable',
      unavailableContent,
    });

    expect(result).toBe('unavailable');
    expect(addAIChatMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
      id: 'msg-unavailable',
      content: unavailableContent,
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('settles the pending assistant message when the AI service is missing', async () => {
    const addAIChatMessage = vi.fn();
    const updateAIChatMessage = vi.fn();
    const setSending = vi.fn();
    (globalThis as any).window = {};

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      updateAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-unavailable',
      pendingAssistantMessageId: 'assistant-connecting',
    });

    expect(result).toBe('unavailable');
    expect(addAIChatMessage).not.toHaveBeenCalled();
    expect(updateAIChatMessage).toHaveBeenCalledWith('session-1', 'assistant-connecting', expect.objectContaining({
      content: '❌ AI Service is not ready',
      loading: false,
      phase: 'idle',
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('sanitizes thrown errors and preserves the raw error when the cleaned text changes', async () => {
    const AIChatSend = vi.fn().mockRejectedValue(new Error('<html><title>502 Bad Gateway</title></html>'));
    const addAIChatMessage = vi.fn();
    const setSending = vi.fn();

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatSend },
        },
      },
    };

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-error',
    });

    expect(result).toBe('error');
    expect(addAIChatMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
      id: 'msg-error',
      content: '❌ Send failed: HTTP 502: 502 Bad Gateway',
      rawError: '<html><title>502 Bad Gateway</title></html>',
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('settles the pending assistant message when streaming startup throws', async () => {
    const AIChatStream = vi.fn().mockRejectedValue(new Error('<html><title>502 Bad Gateway</title></html>'));
    const addAIChatMessage = vi.fn();
    const updateAIChatMessage = vi.fn();
    const setSending = vi.fn();

    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatStream },
        },
      },
    };

    const result = await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      updateAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-error',
      pendingAssistantMessageId: 'assistant-connecting',
    });

    expect(result).toBe('error');
    expect(addAIChatMessage).not.toHaveBeenCalled();
    expect(updateAIChatMessage).toHaveBeenCalledWith('session-1', 'assistant-connecting', expect.objectContaining({
      content: '❌ Send failed: HTTP 502: 502 Bad Gateway',
      rawError: '<html><title>502 Bad Gateway</title></html>',
      loading: false,
      phase: 'idle',
    }));
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('localizes fallback service and dispatch error messages while preserving raw error detail', async () => {
    const addAIChatMessage = vi.fn();
    const updateAIChatMessage = vi.fn();
    const setSending = vi.fn();
    (globalThis as any).window = {};

    await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      updateAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-unavailable',
      pendingAssistantMessageId: 'assistant-connecting',
      translate: (key, params) => translateCatalog(key, params, 'en-US'),
    } as Parameters<typeof dispatchAIChatPayload>[0] & {
      translate: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;
    });

    expect(updateAIChatMessage).toHaveBeenCalledWith('session-1', 'assistant-connecting', expect.objectContaining({
      content: '❌ AI Service is not ready',
    }));

    const AIChatStream = vi.fn().mockRejectedValue(new Error('<html><title>502 Bad Gateway</title></html>'));
    (globalThis as any).window = {
      go: {
        aiservice: {
          Service: { AIChatStream },
        },
      },
    };
    updateAIChatMessage.mockClear();

    await dispatchAIChatPayload({
      sid: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      addAIChatMessage,
      updateAIChatMessage,
      setSending,
      nextMessageId: () => 'msg-error',
      pendingAssistantMessageId: 'assistant-connecting',
      translate: (key, params) => translateCatalog(key, params, 'en-US'),
    } as Parameters<typeof dispatchAIChatPayload>[0] & {
      translate: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;
    });

    expect(updateAIChatMessage).toHaveBeenCalledWith('session-1', 'assistant-connecting', expect.objectContaining({
      content: '❌ Send failed: HTTP 502: 502 Bad Gateway',
      rawError: '<html><title>502 Bad Gateway</title></html>',
    }));
  });
});
