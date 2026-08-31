import React, { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useStore } from '../../store';
import type { AIToolCall } from '../../types';
import { clearQueryTabDraft, setQueryTabDraft } from '../../utils/sqlFileTabDrafts';
import {
  beginAIChatLocalToolTerminalStop,
  resetAIChatLocalToolStop,
} from './aiChatLocalToolLifecycle';
import { useAIChatLocalTools } from './useAIChatLocalTools';

const compressContextIfNeededMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>(async () => null));
const dispatchAIChatPayloadMock = vi.hoisted(() => vi.fn(async (_options: any) => 'stream'));
const executeLocalAIToolCallMock = vi.hoisted(() => vi.fn(async ({ toolCall }: { toolCall: AIToolCall }) => ({
  content: `result:${toolCall.function.name}`,
  success: true,
  toolName: toolCall.function.name,
  countsAsProbeFailure: true,
})));

vi.mock('./aiChatPayloadDispatch', () => ({
  dispatchAIChatPayload: dispatchAIChatPayloadMock,
}));

vi.mock('../../utils/aiChatRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../utils/aiChatRuntime')>('../../utils/aiChatRuntime');
  return {
    ...actual,
    compressContextIfNeeded: compressContextIfNeededMock,
  };
});

vi.mock('./aiLocalToolExecutor', () => ({
  executeLocalAIToolCall: executeLocalAIToolCallMock,
  buildToolResultMessage: ({ id, timestamp, toolCall, execution }: any) => ({
    id,
    role: 'tool',
    content: execution.content,
    timestamp,
    tool_call_id: toolCall.id,
    tool_name: execution.toolName,
    success: execution.success,
  }),
}));

const SESSION_ID = 'session-local-tools';
const translatedCopy: Record<string, string> = {
  'ai_chat.panel.probe.max_rounds': 'T:max-rounds {{count}}',
  'ai_chat.panel.probe.consecutive_failed': 'T:probe-failed',
  'ai_chat.panel.status.summarizing_probe': 'T:summarizing-probe',
  'ai_chat.panel.status.returning_runtime_data': 'T:returning-runtime-data',
  'ai_chat.panel.status.deep_reasoning': 'T:deep-reasoning',
  'ai_chat.panel.status.waiting_instruction': 'T:waiting-instruction',
  'ai_chat.panel.status.analyzing_chain': 'T:analyzing-chain',
  'ai_chat.panel.status.memory_probe_summary': 'T:memory-summary {{summary}}',
  'ai_chat.panel.model_control.continue_after_summary': 'T:continue-after-summary',
  'ai_chat.panel.tool_error.invalid_arguments': 'T:invalid-tool-call-arguments',
  'ai_chat.panel.tool_error.invalid_call_ids': 'T:invalid-tool-call-ids',
};

const translate = (
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) => (translatedCopy[key] || key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params?.[name] ?? ''));

const buildToolCall = (name: string): AIToolCall => ({
  id: `call-${name}`,
  type: 'function',
  function: {
    name,
    arguments: '{}',
  },
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const updateMessage = (
  sessionId: string,
  messageId: string,
  patch: Parameters<ReturnType<typeof useStore.getState>['updateAIChatMessage']>[2],
) => useStore.getState().updateAIChatMessage(sessionId, messageId, patch);

let latestHook: ReturnType<typeof useAIChatLocalTools> | undefined;

const LocalToolsHarness = ({ initialSending = false }: { initialSending?: boolean }) => {
  const [sending, setSending] = useState(initialSending);
  const pendingJVMPlanContextRef = useRef<any>(undefined);
  const pendingJVMDiagnosticPlanContextRef = useRef<any>(undefined);
  const sendOptionsRef = useRef({ model: 'glm-test', thinkingIntensity: 'high' });

  latestHook = useAIChatLocalTools({
    sid: SESSION_ID,
    activeProviderModel: 'gpt-5',
    availableTools: [{
      type: 'function',
      function: {
        name: 'inspect_active_tab',
        description: 'inspect tab',
        parameters: { type: 'object', properties: {} },
      },
    }],
    buildSystemContextMessages: async () => [{ role: 'system', content: 'system-context' }],
    dynamicModels: ['gpt-5'],
    mcpTools: [],
    nextMessageId: () => `generated-${Math.random().toString(36).slice(2, 6)}`,
    pendingJVMPlanContextRef,
    pendingJVMDiagnosticPlanContextRef,
    sendOptionsRef,
    setSending,
    skills: [],
    translate,
    updateAIChatMessage: updateMessage,
    userPromptSettings: {
      global: '',
      database: '',
      jvm: '',
      jvmDiagnostic: '',
    },
  });

  return <span data-sending={sending} />;
};

describe('useAIChatLocalTools', () => {

  beforeEach(() => {
    vi.useFakeTimers();
    resetAIChatLocalToolStop(SESSION_ID);
    compressContextIfNeededMock.mockReset();
    compressContextIfNeededMock.mockResolvedValue(null);
    dispatchAIChatPayloadMock.mockClear();
    executeLocalAIToolCallMock.mockClear();
    latestHook = undefined;
    useStore.setState({
      activeContext: { connectionId: 'conn-1', dbName: 'crm' },
      aiChatHistory: {
        [SESSION_ID]: [
          { id: 'user-1', role: 'user', content: '查一下当前页签', timestamp: 1 },
          {
            id: 'assistant-1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            loading: true,
            phase: 'tool_calling',
            tool_calls: [buildToolCall('inspect_active_tab')],
          },
        ],
      },
      aiChatSessions: [{ id: SESSION_ID, title: '查一下当前页签', updatedAt: 1 }],
      aiActiveSessionId: SESSION_ID,
      connections: [{
        id: 'conn-1',
        name: '主库',
        config: {
          type: 'mysql',
          host: '127.0.0.1',
          port: 3306,
          user: 'root',
        },
      }],
      tabs: [{
        id: 'tab-1',
        title: '订单查询',
        type: 'query',
        connectionId: 'conn-1',
        dbName: 'crm',
        query: 'select * from orders',
      }],
      activeTabId: 'tab-1',
      aiContexts: {},
      sqlLogs: [],
      savedQueries: [],
      sqlSnippets: [],
      externalSQLDirectories: [],
    });
  });

  afterEach(() => {
    resetAIChatLocalToolStop(SESSION_ID);
    clearQueryTabDraft('tab-1');
    vi.useRealTimers();
    useStore.setState({
      activeContext: null,
      aiChatHistory: {},
      aiChatSessions: [],
      aiActiveSessionId: null,
      tabs: [],
      activeTabId: null,
      aiContexts: {},
      sqlLogs: [],
      savedQueries: [],
      sqlSnippets: [],
      externalSQLDirectories: [],
    });
  });

  it('passes the latest editor draft to SQL inspection tools without a Zustand tab write', async () => {
    setQueryTabDraft('tab-1', 'select live SQL from editor');
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await run;
    });

    const executionOptions = executeLocalAIToolCallMock.mock.calls[0]?.[0] as any;
    expect(executionOptions.tabs[0]).toEqual(expect.objectContaining({
      id: 'tab-1',
      query: 'select live SQL from editor',
    }));
    expect(executionOptions.availableTools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: expect.objectContaining({ name: 'inspect_active_tab' }),
      }),
    ]));
    expect(useStore.getState().tabs[0]?.query).toBe('select * from orders');

    await act(async () => renderer?.unmount());
  });

  it('writes tool results, closes the tool-calling message, and excludes connecting placeholders from the chained request', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    expect(latestHook).toBeDefined();
    const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await run;
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    const assistant = messages.find((message) => message.id === 'assistant-1');
    const toolResult = messages.find((message) => message.role === 'tool');
    const connecting = messages.find((message) => message.phase === 'connecting');

    expect(executeLocalAIToolCallMock).toHaveBeenCalledTimes(1);
    expect(assistant).toMatchObject({ loading: false, phase: 'idle' });
    expect(toolResult).toMatchObject({
      content: 'result:inspect_active_tab',
      success: true,
      tool_name: 'inspect_active_tab',
    });
    expect(connecting).toMatchObject({ content: 'T:summarizing-probe', loading: true });

    expect(dispatchAIChatPayloadMock).toHaveBeenCalledTimes(1);
    const dispatchArgs = dispatchAIChatPayloadMock.mock.calls[0][0] as any;
    expect(dispatchArgs.messages[0]).toEqual({ role: 'system', content: 'system-context' });
    expect(JSON.stringify(dispatchArgs.messages)).toContain('result:inspect_active_tab');
    expect(JSON.stringify(dispatchArgs.messages)).not.toContain('T:summarizing-probe');
    expect(dispatchArgs.tools).toHaveLength(1);
    expect(dispatchArgs.sendOptions).toEqual({ model: 'glm-test', thinkingIntensity: 'high' });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not invoke a local runtime when terminal stop is committed before execution starts', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    await act(async () => {
      await latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
      await terminalStop.waitForIdle();
    });

    expect(executeLocalAIToolCallMock).not.toHaveBeenCalled();
    expect(dispatchAIChatPayloadMock).not.toHaveBeenCalled();
    expect(useStore.getState().aiChatHistory[SESSION_ID]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'assistant-1' }),
    ]));

    await act(async () => renderer?.unmount());
  });

  it('continues a queued local runtime when terminal cancellation rolls back', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(executeLocalAIToolCallMock).not.toHaveBeenCalled();

    terminalStop.rollback();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await run;
    });

    expect(executeLocalAIToolCallMock).toHaveBeenCalledTimes(1);
    expect(dispatchAIChatPayloadMock).toHaveBeenCalledTimes(1);
    await expect(terminalStop.waitForIdle()).resolves.toBeUndefined();

    await act(async () => renderer?.unmount());
  });

  it('keeps the matching result but does not continue the model turn when stopped during a runtime', async () => {
    const deferredExecution = createDeferred<any>();
    executeLocalAIToolCallMock.mockImplementationOnce(() => deferredExecution.promise);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const toolCall = buildToolCall('inspect_active_tab');
    let run!: Promise<void>;
    await act(async () => {
      run = latestHook!.executeLocalTools([toolCall], 'assistant-1');
      await Promise.resolve();
    });
    expect(executeLocalAIToolCallMock).toHaveBeenCalledTimes(1);

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    deferredExecution.resolve({
      content: 'result:inspect_active_tab',
      success: true,
      toolName: 'inspect_active_tab',
      countsAsProbeFailure: true,
    });
    await act(async () => {
      await run;
      await terminalStop.waitForIdle();
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages.find((message) => message.id === 'assistant-1')).toMatchObject({
      tool_calls: [toolCall],
      loading: false,
      phase: 'idle',
    });
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'result:inspect_active_tab',
      }),
    ]));
    expect(dispatchAIChatPayloadMock).not.toHaveBeenCalled();

    await act(async () => renderer?.unmount());
  });

  it('keeps input locked until every concurrently stopped local runtime has settled', async () => {
    const firstExecution = createDeferred<any>();
    const secondExecution = createDeferred<any>();
    executeLocalAIToolCallMock
      .mockImplementationOnce(() => firstExecution.promise)
      .mockImplementationOnce(() => secondExecution.promise);
    const firstCall = buildToolCall('inspect_active_tab');
    const secondCall = { ...buildToolCall('execute_sql'), id: 'call-execute-sql-concurrent' };
    useStore.getState().addAIChatMessage(SESSION_ID, {
      id: 'assistant-2',
      role: 'assistant',
      content: '',
      timestamp: 3,
      loading: true,
      phase: 'tool_calling',
      tool_calls: [secondCall],
    });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness initialSending />);
    });

    let firstRun!: Promise<void>;
    let secondRun!: Promise<void>;
    await act(async () => {
      firstRun = latestHook!.executeLocalTools([firstCall], 'assistant-1');
      secondRun = latestHook!.executeLocalTools([secondCall], 'assistant-2');
      await Promise.resolve();
    });
    expect(executeLocalAIToolCallMock).toHaveBeenCalledTimes(2);

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    firstExecution.resolve({
      content: 'result:first',
      success: true,
      toolName: 'inspect_active_tab',
      countsAsProbeFailure: true,
    });
    await act(async () => {
      await firstRun;
    });

    expect(renderer?.root.findByType('span').props['data-sending']).toBe(true);
    let allIdle = false;
    void terminalStop.waitForIdle().then(() => {
      allIdle = true;
    });
    await Promise.resolve();
    expect(allIdle).toBe(false);

    secondExecution.resolve({
      content: 'result:second',
      success: true,
      toolName: 'execute_sql',
      countsAsProbeFailure: true,
    });
    await act(async () => {
      await secondRun;
      await terminalStop.waitForIdle();
    });

    expect(renderer?.root.findByType('span').props['data-sending']).toBe(true);
    expect(dispatchAIChatPayloadMock).not.toHaveBeenCalled();
    await act(async () => renderer?.unmount());
  });

  it('stops a multi-tool batch after the completed call and removes unexecuted calls', async () => {
    const deferredExecution = createDeferred<any>();
    executeLocalAIToolCallMock.mockImplementationOnce(() => deferredExecution.promise);
    const firstCall = buildToolCall('inspect_active_tab');
    const secondCall = buildToolCall('execute_sql');
    updateMessage(SESSION_ID, 'assistant-1', { tool_calls: [firstCall, secondCall] });
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    let run!: Promise<void>;
    await act(async () => {
      run = latestHook!.executeLocalTools([firstCall, secondCall], 'assistant-1');
      await Promise.resolve();
    });
    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    deferredExecution.resolve({
      content: 'result:inspect_active_tab',
      success: true,
      toolName: 'inspect_active_tab',
      countsAsProbeFailure: true,
    });
    await act(async () => {
      await run;
      await terminalStop.waitForIdle();
    });

    expect(executeLocalAIToolCallMock).toHaveBeenCalledTimes(1);
    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages.find((message) => message.id === 'assistant-1')?.tool_calls).toEqual([firstCall]);
    expect(messages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({ tool_call_id: firstCall.id }),
    ]);
    expect(dispatchAIChatPayloadMock).not.toHaveBeenCalled();

    await act(async () => renderer?.unmount());
  });

  it.each([
    [
      'an empty ID',
      [{ ...buildToolCall('inspect_active_tab'), id: '   ' }],
    ],
    [
      'duplicate IDs in one batch',
      [
        { ...buildToolCall('inspect_active_tab'), id: 'call-duplicate' },
        { ...buildToolCall('inspect_active_tab'), id: 'call-duplicate' },
      ],
    ],
  ])('atomically rejects tool calls with %s before invoking any runtime', async (_label, toolCalls) => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const run = latestHook!.executeLocalTools(toolCalls, 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(toolCalls.length * 150);
      await run;
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(executeLocalAIToolCallMock).not.toHaveBeenCalled();
    expect(dispatchAIChatPayloadMock).not.toHaveBeenCalled();
    expect(messages.some((message) => message.role === 'tool')).toBe(false);
    expect(messages.find((message) => message.id === 'assistant-1')).toMatchObject({
      loading: false,
      phase: 'idle',
      tool_calls: undefined,
      excludeFromAIContext: true,
    });
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'T:invalid-tool-call-ids',
        excludeFromAIContext: true,
        loading: false,
      }),
    ]));

    await act(async () => renderer?.unmount());
  });

  it('atomically rejects a mixed batch containing malformed arguments before invoking any runtime', async () => {
    const validCall = buildToolCall('inspect_active_tab');
    const malformedCall: AIToolCall = {
      ...buildToolCall('execute_sql'),
      function: {
        ...buildToolCall('execute_sql').function,
        arguments: '{"connectionId":"conn-1"',
      },
    };
    const toolCalls = [validCall, malformedCall];
    updateMessage(SESSION_ID, 'assistant-1', { tool_calls: toolCalls });

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const run = latestHook!.executeLocalTools(toolCalls, 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(toolCalls.length * 150);
      await run;
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(executeLocalAIToolCallMock).not.toHaveBeenCalled();
    expect(dispatchAIChatPayloadMock).not.toHaveBeenCalled();
    expect(messages.some((message) => message.role === 'tool')).toBe(false);
    expect(messages.find((message) => message.id === 'assistant-1')).toMatchObject({
      loading: false,
      phase: 'idle',
      tool_calls: undefined,
      excludeFromAIContext: true,
    });
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'T:invalid-tool-call-arguments',
        excludeFromAIContext: true,
        loading: false,
      }),
    ]));

    await act(async () => renderer?.unmount());
  });

  it.each([
    ['empty', ''],
    ['blank', '  \n\t'],
  ])('normalizes %s arguments before local execution', async (_label, argumentsJSON) => {
    const toolCall = buildToolCall('inspect_active_tab');
    toolCall.function.arguments = argumentsJSON;
    updateMessage(SESSION_ID, 'assistant-1', { tool_calls: [toolCall] });

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    const run = latestHook!.executeLocalTools([toolCall], 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await run;
    });

    expect(executeLocalAIToolCallMock).toHaveBeenCalledOnce();
    expect(executeLocalAIToolCallMock.mock.calls[0][0].toolCall.function.arguments).toBe('{}');
    expect(dispatchAIChatPayloadMock).toHaveBeenCalledOnce();

    await act(async () => renderer?.unmount());
  });

  it('shows translated progress updates while waiting for the chained request to continue', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    expect(latestHook).toBeDefined();
    const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await run;
    });

    const findConnecting = () =>
      (useStore.getState().aiChatHistory[SESSION_ID] || []).find((message) => message.phase === 'connecting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(findConnecting()).toMatchObject({ content: 'T:returning-runtime-data' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(findConnecting()).toMatchObject({ content: 'T:deep-reasoning' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(findConnecting()).toMatchObject({ content: 'T:waiting-instruction' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });
    expect(findConnecting()).toMatchObject({ content: 'T:analyzing-chain' });

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not auto-stop the probe after three recoverable SQL execution errors', async () => {
    executeLocalAIToolCallMock.mockResolvedValue({
      content: "oceanbase: error 900 (42000): ORA-00900 near '50 OFFSET 0'",
      success: false,
      toolName: 'execute_sql',
      countsAsProbeFailure: false,
    });

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    expect(latestHook).toBeDefined();
    for (let i = 0; i < 3; i += 1) {
      const run = latestHook!.executeLocalTools([buildToolCall('execute_sql')], 'assistant-1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
        await run;
      });
    }

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages.some((message) => message.content.includes('探针连续 3 轮执行失败'))).toBe(false);
    expect(dispatchAIChatPayloadMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('shows the localized max-round warning after the tool-call cap is exceeded', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    expect(latestHook).toBeDefined();
    for (let i = 0; i <= 15; i += 1) {
      if (i > 0) {
        updateMessage(SESSION_ID, 'assistant-1', {
          loading: true,
          phase: 'tool_calling',
        });
      }
      const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
        await run;
      });
    }

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    const assistant = messages.find((message) => message.id === 'assistant-1');
    const limitWarning = messages.find((message) => message.content === 'T:max-rounds 15');

    expect(assistant).toMatchObject({ loading: false, phase: 'idle' });
    expect(limitWarning).toMatchObject({ role: 'assistant', excludeFromAIContext: true });
    expect(dispatchAIChatPayloadMock).toHaveBeenCalledTimes(15);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('replaces long probe history with localized summary prompts before resending', async () => {
    compressContextIfNeededMock.mockResolvedValue('summary-body');

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    expect(latestHook).toBeDefined();
    const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      await run;
    });

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: 'T:memory-summary summary-body' }),
      expect.objectContaining({ role: 'user', content: 'T:continue-after-summary' }),
    ]));

    const dispatchArgs = dispatchAIChatPayloadMock.mock.calls[0][0] as any;
    expect(dispatchArgs.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', content: 'T:memory-summary summary-body' }),
      expect.objectContaining({ role: 'user', content: 'T:continue-after-summary' }),
    ]));

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('closes the current assistant message when three consecutive probe failures trigger the localized stop warning', async () => {
    executeLocalAIToolCallMock.mockResolvedValue({
      content: 'dial tcp 127.0.0.1:3306: connect: connection refused',
      success: false,
      toolName: 'inspect_active_tab',
      countsAsProbeFailure: true,
    });

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LocalToolsHarness />);
    });

    expect(latestHook).toBeDefined();
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) {
        updateMessage(SESSION_ID, 'assistant-1', {
          loading: true,
          phase: 'tool_calling',
        });
      }
      const run = latestHook!.executeLocalTools([buildToolCall('inspect_active_tab')], 'assistant-1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
        await run;
      });
    }

    const messages = useStore.getState().aiChatHistory[SESSION_ID] || [];
    const assistant = messages.find((message) => message.id === 'assistant-1');
    const stopWarning = messages.find((message) => message.content === 'T:probe-failed');

    expect(assistant).toMatchObject({ loading: false, phase: 'idle' });
    expect(stopWarning).toMatchObject({ role: 'assistant', excludeFromAIContext: true });
    expect(dispatchAIChatPayloadMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
