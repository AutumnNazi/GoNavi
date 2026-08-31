import React, { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useStore } from '../../store';
import { resetAIChatLocalToolStop } from './aiChatLocalToolLifecycle';
import {
  flushAIChatStreamBuffers,
  prepareAIChatStreamForTerminalAction,
  useAIChatStreamSubscription,
} from './useAIChatStreamSubscription';

const aiChatStreamMock = vi.hoisted(() => vi.fn(async (..._args: any[]) => undefined));
const generateTitleForSessionMock = vi.hoisted(() => vi.fn(async () => undefined));
const executeLocalToolsMock = vi.hoisted(() => vi.fn(async (..._args: any[]) => undefined));
const buildSystemContextMessagesMock = vi.hoisted(() => vi.fn(async () => [] as any[]));
const runtimeMock = vi.hoisted(() => {
  const handlers = new Map<string, (data: any) => void>();
  return {
    handlers,
    EventsOn: vi.fn((eventName: string, handler: (data: any) => void) => {
      handlers.set(eventName, handler);
    }),
    EventsOff: vi.fn((eventName: string) => {
      handlers.delete(eventName);
    }),
  };
});

vi.mock('../../../wailsjs/runtime', () => ({
  EventsOn: runtimeMock.EventsOn,
  EventsOff: runtimeMock.EventsOff,
}));

const SESSION_ID = 'session-stream';
const translatedCopy: Record<string, string> = {
  'ai_chat.panel.model_control.force_tool_call': 'T:force-tool-call',
  'ai_chat.panel.message.error': 'T:error {{detail}}',
  'ai_chat.panel.message.empty_response': 'T:empty-response',
  'ai_chat.panel.message.request_interrupted': 'T:request-interrupted',
};

const translate = (
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) => (translatedCopy[key] || key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params?.[name] ?? ''));
let nextId = 0;
let patchMessageCalls = 0;

const emitStreamChunk = async (data: any) => {
  const handler = runtimeMock.handlers.get(`ai:stream:${SESSION_ID}`);
  expect(handler).toBeTypeOf('function');
  await act(async () => {
    handler?.(data);
    await Promise.resolve();
  });
};

const appendMessage = (
  sessionId: string,
  message: Parameters<ReturnType<typeof useStore.getState>['addAIChatMessage']>[1],
) => {
  useStore.setState((state) => {
    const messages = state.aiChatHistory[sessionId] || [];
    return {
      aiChatHistory: {
        ...state.aiChatHistory,
        [sessionId]: [...messages, message],
      },
    };
  });
};

const patchMessage = (
  sessionId: string,
  messageId: string,
  patch: Parameters<ReturnType<typeof useStore.getState>['updateAIChatMessage']>[2],
) => {
  patchMessageCalls += 1;
  useStore.setState((state) => {
    const messages = state.aiChatHistory[sessionId];
    if (!messages) {
      return state;
    }
    return {
      aiChatHistory: {
        ...state.aiChatHistory,
        [sessionId]: messages.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message,
        ),
      },
    };
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const StreamHarness = ({ initialNudgeCount = 0 }: { initialNudgeCount?: number }) => {
  const [sending, setSending] = useState(true);
  const nudgeCountRef = useRef(initialNudgeCount);
  const pendingJVMPlanContextRef = useRef<any>(undefined);
  const pendingJVMDiagnosticPlanContextRef = useRef<any>(undefined);
  const sendOptionsRef = useRef({ model: 'glm-test', thinkingIntensity: 'high' });

  useAIChatStreamSubscription({
    sid: SESSION_ID,
    sending,
    setSending,
    availableTools: [],
    addAIChatMessage: appendMessage,
    updateAIChatMessage: patchMessage,
    buildSystemContextMessages: buildSystemContextMessagesMock,
    executeLocalTools: executeLocalToolsMock,
    generateTitleForSession: generateTitleForSessionMock,
    nextMessageId: () => `assistant-created-${++nextId}`,
    nudgeCountRef,
    pendingJVMPlanContextRef,
    pendingJVMDiagnosticPlanContextRef,
    sendOptionsRef,
    translate,
  });

  return <span data-sending={sending ? 'true' : 'false'} />;
};

describe('useAIChatStreamSubscription', () => {

  beforeEach(() => {
    resetAIChatLocalToolStop(SESSION_ID);
    nextId = 0;
    patchMessageCalls = 0;
    aiChatStreamMock.mockClear();
    generateTitleForSessionMock.mockClear();
    executeLocalToolsMock.mockClear();
    buildSystemContextMessagesMock.mockReset();
    buildSystemContextMessagesMock.mockResolvedValue([]);
    runtimeMock.handlers.clear();
    runtimeMock.EventsOn.mockClear();
    runtimeMock.EventsOff.mockClear();
    vi.stubGlobal('window', {
      go: {
        aiservice: {
          Service: {
            AIChatStream: aiChatStreamMock,
          },
        },
      },
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    useStore.setState({
      aiChatHistory: {
        [SESSION_ID]: [
          {
            id: 'user-1',
            role: 'user',
            content: 'hello',
            timestamp: 1,
          },
          {
            id: 'assistant-connecting',
            role: 'assistant',
            phase: 'connecting',
            content: '',
            timestamp: 2,
            loading: true,
          },
        ],
      },
      aiChatSessions: [{ id: SESSION_ID, title: 'hello', updatedAt: 1 }],
      aiActiveSessionId: SESSION_ID,
    });
  });

  afterEach(() => {
    resetAIChatLocalToolStop(SESSION_ID);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useStore.setState({
      aiChatHistory: {},
      aiChatSessions: [],
      aiActiveSessionId: null,
    });
  });

  it('keeps streamed chunks in the same assistant message after a parent rerender', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: 'Hello' });
    await emitStreamChunk({ content: ' world' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90);
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    const assistantMessages = messages.filter((message) => message.role === 'assistant');

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: 'assistant-connecting',
      phase: 'generating',
      content: 'Hello world',
      loading: true,
    });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('keeps session actions locked until the stream reaches done', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: 'first token' });
    expect(renderer!.root.findByType('span').props['data-sending']).toBe('true');

    await emitStreamChunk({ done: true });
    expect(renderer!.root.findByType('span').props['data-sending']).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(renderer!.root.findByType('span').props['data-sending']).toBe('false');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('cancels the queued local-tool execution when terminal stop lands after stream completion', async () => {
    vi.useFakeTimers();
    const setSending = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      tool_calls: [{
        id: 'call-queued',
        type: 'function',
        function: { name: 'execute_sql', arguments: '{"sql":"SELECT 1"}' },
      }],
    });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await expect(prepareAIChatStreamForTerminalAction({
      sid: SESSION_ID,
      service: { AIChatCancelAndWait: vi.fn(async () => true) },
      setSending,
      settleDelayMs: 0,
    })).resolves.toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(executeLocalToolsMock).not.toHaveBeenCalled();
    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).flatMap((message) => message.tool_calls || []),
    ).toHaveLength(0);

    await act(async () => renderer?.unmount());
  });

  it('does not execute a queued local tool after the stream subscription unmounts', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      tool_calls: [{
        id: 'call-unmounted',
        type: 'function',
        function: { name: 'execute_sql', arguments: '{"sql":"SELECT 1"}' },
      }],
    });
    await emitStreamChunk({ done: true });
    await act(async () => {
      renderer?.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(executeLocalToolsMock).not.toHaveBeenCalled();
  });

  it('coalesces high-frequency thinking chunks before writing them to the store', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ thinking: 'A' });
    const callsAfterScheduling = patchMessageCalls;
    await emitStreamChunk({ thinking: 'B' });
    await emitStreamChunk({ thinking: 'C' });

    expect(patchMessageCalls).toBe(callsAfterScheduling);
    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find((message) => message.id === 'assistant-connecting'),
    ).not.toHaveProperty('thinking');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90);
    });

    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find((message) => message.id === 'assistant-connecting'),
    ).toMatchObject({
      thinking: 'ABC',
      phase: 'thinking',
    });
    expect(patchMessageCalls).toBe(callsAfterScheduling + 1);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('flushes the final buffered token synchronously before a detached window exits', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: 'tail' });
    flushAIChatStreamBuffers([SESSION_ID]);

    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find(
        (message) => message.id === 'assistant-connecting',
      )?.content,
    ).toBe('tail');
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('keeps the streaming message active when cancel-and-wait cannot stop the producer', async () => {
    const setSending = vi.fn();
    const cancelAndWait = vi.fn(async () => false);

    await expect(prepareAIChatStreamForTerminalAction({
      sid: SESSION_ID,
      service: { AIChatCancelAndWait: cancelAndWait },
      setSending,
      settleDelayMs: 0,
    })).resolves.toBe(false);

    expect(cancelAndWait).toHaveBeenCalledWith(SESSION_ID);
    expect(setSending).not.toHaveBeenCalled();
    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find(
        (message) => message.id === 'assistant-connecting',
      ),
    ).toMatchObject({ loading: true, phase: 'connecting' });
  });

  it('flushes buffered content and settles loading assistant messages after cancellation', async () => {
    vi.useFakeTimers();
    const setSending = vi.fn();
    const cancelAndWait = vi.fn(async () => true);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: 'final token' });
    await expect(prepareAIChatStreamForTerminalAction({
      sid: SESSION_ID,
      service: { AIChatCancelAndWait: cancelAndWait },
      setSending,
      settleDelayMs: 0,
    })).resolves.toBe(true);

    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find(
        (message) => message.id === 'assistant-connecting',
      ),
    ).toMatchObject({
      content: 'final token',
      loading: false,
      phase: 'idle',
    });
    expect(setSending).toHaveBeenCalledWith(false);
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('drops orphaned tool calls on cancellation and binds the next stream to its new placeholder', async () => {
    vi.useFakeTimers();
    const setSending = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      tool_calls: [{
        id: 'call-partial',
        type: 'function',
        function: { name: 'execute_sql', arguments: '{"sql":"SELECT' },
      }],
    });
    await expect(prepareAIChatStreamForTerminalAction({
      sid: SESSION_ID,
      service: { AIChatCancelAndWait: vi.fn(async () => true) },
      setSending,
      settleDelayMs: 0,
    })).resolves.toBe(true);

    expect(useStore.getState().aiChatHistory[SESSION_ID]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assistant-connecting' }),
    ]));
    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).flatMap((message) => message.tool_calls || []),
    ).toHaveLength(0);

    appendMessage(SESSION_ID, {
      id: 'assistant-next',
      role: 'assistant',
      phase: 'connecting',
      content: 'waiting',
      timestamp: 3,
      loading: true,
    });
    await emitStreamChunk({ content: 'after cancel' });
    flushAIChatStreamBuffers([SESSION_ID]);

    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find((message) => message.id === 'assistant-next'),
    ).toMatchObject({ content: 'after cancel', loading: true });

    await act(async () => renderer?.unmount());
  });

  it('cancels and settles every session before a native terminal handoff', async () => {
    const setSending = vi.fn();
    const cancelAllAndWait = vi.fn(async () => true);
    const cancelAndWait = vi.fn(async () => true);
    useStore.setState((state) => ({
      aiChatHistory: {
        ...state.aiChatHistory,
        'session-other': [{
          id: 'assistant-other',
          role: 'assistant',
          content: 'partial',
          timestamp: 3,
          loading: true,
          phase: 'generating',
        }],
      },
      aiChatSessions: [
        ...state.aiChatSessions,
        { id: 'session-other', title: 'other', updatedAt: 3 },
      ],
    }));

    await expect(prepareAIChatStreamForTerminalAction({
      sid: SESSION_ID,
      service: {
        AIChatCancelAllAndWait: cancelAllAndWait,
        AIChatCancelAndWait: cancelAndWait,
      },
      setSending,
      settleDelayMs: 0,
      allSessions: true,
    })).resolves.toBe(true);

    expect(cancelAllAndWait).toHaveBeenCalledOnce();
    expect(cancelAndWait).not.toHaveBeenCalled();
    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find(
        (message) => message.id === 'assistant-connecting',
      ),
    ).toBeUndefined();
    expect(
      (useStore.getState().aiChatHistory['session-other'] || []).find(
        (message) => message.id === 'assistant-other',
      ),
    ).toMatchObject({ loading: false, phase: 'idle' });
    expect(setSending).toHaveBeenCalledWith(false);
  });

  it('resends a localized force-tool-call nudge when the model only describes the next action', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: '我先查询一下相关信息' });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1);
    const resentMessages = (aiChatStreamMock.mock.calls[0]?.[1] ?? []) as Array<{ role: string; content: string }>;
    expect(resentMessages[resentMessages.length - 1]).toEqual({ role: 'user', content: 'T:force-tool-call' });
    expect(generateTitleForSessionMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not dispatch a force-tool nudge after terminal stop while context is still building', async () => {
    vi.useFakeTimers();
    const deferredContext = createDeferred<any[]>();
    buildSystemContextMessagesMock.mockReturnValueOnce(deferredContext.promise);
    const setSending = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: '我先查询一下相关信息' });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(buildSystemContextMessagesMock).toHaveBeenCalledTimes(1);

    let terminalStop!: Promise<boolean>;
    await act(async () => {
      terminalStop = prepareAIChatStreamForTerminalAction({
        sid: SESSION_ID,
        service: { AIChatCancelAndWait: vi.fn(async () => true) },
        setSending,
        settleDelayMs: 0,
      });
      await Promise.resolve();
    });
    deferredContext.resolve([]);
    await expect(terminalStop).resolves.toBe(true);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(aiChatStreamMock).not.toHaveBeenCalled();
    await act(async () => renderer?.unmount());
  });

  it('still removes leaked tool-call markup after the force-nudge retry budget is exhausted', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness initialNudgeCount={2} />);
    });

    await emitStreamChunk({
      content: '已完成。<tool_call>execute_sql<arg_key>sql</arg_key><arg_value>SELECT 1</arg_value>',
    });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(aiChatStreamMock).not.toHaveBeenCalled();
    expect(
      (useStore.getState().aiChatHistory[SESSION_ID] || [])
        .find((message) => message.id === 'assistant-connecting')?.content,
    ).toBe('已完成。');
    await act(async () => renderer?.unmount());
  });

  it('resends a localized force-tool-call nudge when the model describes the next action in English', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: "I'll check the relevant information first" });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1);
    const resentMessages = (aiChatStreamMock.mock.calls[0]?.[1] ?? []) as Array<{ role: string; content: string }>;
    expect(resentMessages[resentMessages.length - 1]).toEqual({ role: 'user', content: 'T:force-tool-call' });
    expect(generateTitleForSessionMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('resends a localized force-tool-call nudge when the model describes the next action in Traditional Chinese', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ content: '我先查詢一下相關資料' });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(aiChatStreamMock).toHaveBeenCalledTimes(1);
    const resentMessages = (aiChatStreamMock.mock.calls[0]?.[1] ?? []) as Array<{ role: string; content: string }>;
    expect(resentMessages[resentMessages.length - 1]).toEqual({ role: 'user', content: 'T:force-tool-call' });
    expect(generateTitleForSessionMock).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('repairs leaked textual tool-call markup after an interrupted tool chain', async () => {
    vi.useFakeTimers();
    const AIChatStreamWithOptions = vi.fn(async (..._args: any[]) => undefined);
    vi.stubGlobal('window', {
      go: {
        aiservice: {
          Service: {
            AIChatStreamWithOptions,
            AIChatStream: aiChatStreamMock,
          },
        },
      },
    });
    useStore.setState({
      aiChatHistory: {
        [SESSION_ID]: [
          {
            id: 'assistant-tool',
            role: 'assistant',
            content: '插入订单明细',
            tool_calls: [{
              id: 'call-insert',
              type: 'function',
              function: { name: 'execute_sql', arguments: '{}' },
            }],
            timestamp: 1,
          },
          {
            id: 'tool-result',
            role: 'tool',
            content: '{"affectedRows":90000}',
            tool_call_id: 'call-insert',
            timestamp: 2,
          },
          {
            id: 'assistant-error',
            role: 'assistant',
            content: 'T:error context deadline exceeded',
            timestamp: 3,
          },
          {
            id: 'user-continue',
            role: 'user',
            content: '继续',
            timestamp: 4,
          },
          {
            id: 'assistant-connecting',
            role: 'assistant',
            phase: 'connecting',
            content: '',
            timestamp: 5,
            loading: true,
          },
        ],
      },
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      content: '明细已插入 90,000 行。现在验证各表行数：<tool_call>execute_sql<arg_key>connectionId</arg_key><arg_value>1</arg_value>',
    });
    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(AIChatStreamWithOptions).toHaveBeenCalledTimes(1);
    expect(aiChatStreamMock).not.toHaveBeenCalled();
    const resentMessages = (AIChatStreamWithOptions.mock.calls[0]?.[1] ?? []) as Array<{ role: string; content: string }>;
    expect(resentMessages[resentMessages.length - 1]).toEqual({ role: 'user', content: 'T:force-tool-call' });
    expect(resentMessages.every((message) => !message.content.includes('<tool_call>'))).toBe(true);
    expect(resentMessages.every((message) => !message.content.includes('context deadline exceeded'))).toBe(true);
    expect(AIChatStreamWithOptions.mock.calls[0]?.[3]).toEqual({
      model: 'glm-test',
      thinkingIntensity: 'high',
      temperature: undefined,
      maxTokens: undefined,
    });
    const repaired = (useStore.getState().aiChatHistory[SESSION_ID] || [])
      .find((message) => message.id === 'assistant-connecting');
    expect(repaired?.content).toBe('明细已插入 90,000 行。现在验证各表行数：');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('repairs leaked markup in partial text before separating stream errors from orphaned tool calls', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      content: '已完成前半段。<tool_call>execute_sql<arg_key>sql</arg_key><arg_value>SELECT 1</arg_value>',
    });
    await emitStreamChunk({
      tool_calls: [{
        id: 'call-partial',
        type: 'function',
        function: { name: 'execute_sql', arguments: '{"sql":"SELECT' },
      }],
    });
    await emitStreamChunk({ error: 'context deadline exceeded' });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    const partial = messages.find((message) => message.id === 'assistant-connecting');
    const errorMessage = messages.find((message) => message.id === 'assistant-created-1');

    expect(partial).toMatchObject({
      content: '已完成前半段。',
      phase: 'idle',
      loading: false,
    });
    expect(partial?.tool_calls).toBeUndefined();
    expect(errorMessage).toMatchObject({
      role: 'assistant',
      content: 'T:error context deadline exceeded',
      phase: 'idle',
      loading: false,
      excludeFromAIContext: true,
    });
    expect(errorMessage?.tool_calls).toBeUndefined();
    expect(messages.flatMap((message) => message.tool_calls || [])).toHaveLength(0);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('drops a partial response whose only content is leaked tool-call markup before appending the error', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      content: '&lt;tool_call&gt;execute_sql&lt;arg_key&gt;sql&lt;/arg_key&gt;',
    });
    await emitStreamChunk({ error: 'context deadline exceeded' });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages.some((message) => message.id === 'assistant-connecting')).toBe(false);
    expect(messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({
        id: 'assistant-created-1',
        content: 'T:error context deadline exceeded',
        excludeFromAIContext: true,
      }),
    ]);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('drops a tool-only streaming placeholder before appending the independent error', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({
      tool_calls: [{
        id: 'call-orphaned',
        type: 'function',
        function: { name: 'execute_sql', arguments: '{}' },
      }],
    });
    await emitStreamChunk({ error: 'stream disconnected' });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages.some((message) => message.id === 'assistant-connecting')).toBe(false);
    expect(messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({
        id: 'assistant-created-1',
        content: 'T:error stream disconnected',
        phase: 'idle',
        loading: false,
        excludeFromAIContext: true,
      }),
    ]);
    expect(messages.flatMap((message) => message.tool_calls || [])).toHaveLength(0);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('localizes stream error copy while preserving the sanitized raw detail', async () => {
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ error: 'rpc failure' });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages.some((message) => message.id === 'assistant-connecting')).toBe(false);
    const assistant = messages.find((message) => message.id === 'assistant-created-1');
    expect(assistant).toMatchObject({
      content: 'T:error rpc failure',
      phase: 'idle',
      loading: false,
      excludeFromAIContext: true,
    });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('localizes the empty-response fallback when the stream completes without content', async () => {
    vi.useFakeTimers();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    const assistant = messages.find((message) => message.id === 'assistant-connecting');
    expect(assistant).toMatchObject({
      content: 'T:empty-response',
      phase: 'idle',
      loading: false,
      excludeFromAIContext: true,
    });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('localizes the interrupted-request fallback when no assistant message was created', async () => {
    vi.useFakeTimers();
    useStore.setState({
      aiChatHistory: {
        [SESSION_ID]: [
          {
            id: 'user-1',
            role: 'user',
            content: 'hello',
            timestamp: 1,
          },
        ],
      },
      aiChatSessions: [{ id: SESSION_ID, title: 'hello', updatedAt: 1 }],
      aiActiveSessionId: SESSION_ID,
    });

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<StreamHarness />);
    });

    await emitStreamChunk({ done: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'T:request-interrupted',
        loading: false,
        excludeFromAIContext: true,
      }),
    ]));

    await act(async () => {
      renderer?.unmount();
    });
  });
});
