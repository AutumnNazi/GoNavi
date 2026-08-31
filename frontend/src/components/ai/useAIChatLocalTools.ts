import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { useStore } from '../../store';
import type {
  AIChatMessage,
  AIMCPToolDescriptor,
  AISkillConfig,
  AIToolCall,
  AIUserPromptSettings,
  JVMAIPlanContext,
  JVMDiagnosticPlanContext,
} from '../../types';
import { compressContextIfNeeded, getDynamicMaxContextChars } from '../../utils/aiChatRuntime';
import {
  preflightAIToolCallArguments,
  toAIRequestMessages,
} from '../../utils/aiMessagePayload';
import { resolveLiveQueryTabs } from '../../utils/liveQueryTabs';
import type { AIChatToolDefinition } from '../../utils/aiToolRegistry';
import {
  dispatchAIChatPayload,
  type AIChatSendRequestOptions,
} from './aiChatPayloadDispatch';
import type { AIChatAttachmentTranslator } from './aiChatAttachments';
import {
  beginAIChatLocalToolRun,
  resetAIChatLocalToolStop,
  shouldStopAIChatLocalToolRun,
} from './aiChatLocalToolLifecycle';
import {
  buildToolResultMessage,
  executeLocalAIToolCall,
  type ExecuteLocalAIToolCallResult,
  type AIToolContextEntry,
} from './aiLocalToolExecutor';

interface UseAIChatLocalToolsOptions {
  sid: string;
  activeProviderModel?: string;
  availableTools: AIChatToolDefinition[];
  buildSystemContextMessages: (
    overrideJVMPlanContext?: JVMAIPlanContext,
    overrideJVMDiagnosticPlanContext?: JVMDiagnosticPlanContext,
  ) => any[] | Promise<any[]>;
  dynamicModels: string[];
  mcpTools: AIMCPToolDescriptor[];
  nextMessageId: () => string;
  pendingJVMPlanContextRef: MutableRefObject<JVMAIPlanContext | undefined>;
  pendingJVMDiagnosticPlanContextRef: MutableRefObject<JVMDiagnosticPlanContext | undefined>;
  sendOptionsRef: MutableRefObject<AIChatSendRequestOptions>;
  setSending: (sending: boolean) => void;
  skills: AISkillConfig[];
  translate?: AIChatAttachmentTranslator;
  updateAIChatMessage: (
    sid: string,
    messageId: string,
    patch: Partial<AIChatMessage>,
  ) => void;
  userPromptSettings: AIUserPromptSettings;
}

const MAX_TOOL_CALL_ROUNDS = 15;
const SOFT_LIMIT_ROUNDS = 10;

const hasValidToolCallIds = (toolCalls: AIToolCall[]): boolean => {
  const seen = new Set<string>();
  return toolCalls.every((toolCall) => {
    if (typeof toolCall.id !== 'string') return false;
    const id = toolCall.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const translatePanelCopy = (
  t: AIChatAttachmentTranslator | undefined,
  key: string,
  fallback: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string => {
  if (!t) return fallback;
  const translated = t(key, params);
  return translated && translated !== key ? translated : fallback;
};

export const useAIChatLocalTools = ({
  sid,
  activeProviderModel,
  availableTools,
  buildSystemContextMessages,
  dynamicModels,
  mcpTools,
  nextMessageId,
  pendingJVMPlanContextRef,
  pendingJVMDiagnosticPlanContextRef,
  sendOptionsRef,
  setSending,
  skills,
  translate,
  updateAIChatMessage,
  userPromptSettings,
}: UseAIChatLocalToolsOptions) => {
  const toolCallRoundRef = useRef(0);
  const totalToolRoundRef = useRef(0);
  const toolContextMapRef = useRef<Map<string, AIToolContextEntry>>(new Map());

  const resetToolCallState = useCallback(() => {
    toolCallRoundRef.current = 0;
    totalToolRoundRef.current = 0;
    resetAIChatLocalToolStop(sid);
  }, [sid]);

  const executeLocalToolsInternal = useCallback(async (toolCalls: AIToolCall[], currentAsstMsgId: string) => {
    const store = useStore.getState();
    const currentAsstMsg = (store.aiChatHistory[sid] || []).find((message) => message.id === currentAsstMsgId);
    const inheritedJVMPlanContext = currentAsstMsg?.jvmPlanContext || pendingJVMPlanContextRef.current;
    const inheritedJVMDiagnosticPlanContext =
      currentAsstMsg?.jvmDiagnosticPlanContext || pendingJVMDiagnosticPlanContextRef.current;
    pendingJVMPlanContextRef.current = inheritedJVMPlanContext;
    pendingJVMDiagnosticPlanContextRef.current = inheritedJVMDiagnosticPlanContext;

    const settleStoppedToolRun = (completedToolCalls: AIToolCall[]) => {
      const latest = (useStore.getState().aiChatHistory[sid] || [])
        .find((message) => message.id === currentAsstMsgId);
      if (latest) {
        if (completedToolCalls.length > 0) {
          updateAIChatMessage(sid, currentAsstMsgId, {
            tool_calls: completedToolCalls,
            loading: false,
            phase: 'idle',
          });
        } else if (
          latest.content.trim()
          || latest.thinking?.trim()
          || latest.reasoning_content?.trim()
        ) {
          updateAIChatMessage(sid, currentAsstMsgId, {
            tool_calls: undefined,
            loading: false,
            phase: 'idle',
          });
        } else {
          useStore.getState().deleteAIChatMessage(sid, currentAsstMsgId);
        }
      }
    };

    if (await shouldStopAIChatLocalToolRun(sid)) {
      settleStoppedToolRun([]);
      return;
    }

    const normalizedToolCalls = preflightAIToolCallArguments(toolCalls);
    const invalidToolCallCopy = normalizedToolCalls === null
      ? {
        key: 'ai_chat.panel.tool_error.invalid_arguments',
        fallback: '❌ Invalid tool-call response: tool arguments were incomplete or were not a JSON object. No tools were executed.',
      }
      : !hasValidToolCallIds(normalizedToolCalls)
        ? {
          key: 'ai_chat.panel.tool_error.invalid_call_ids',
          fallback: '❌ Invalid tool-call response: every tool call must have a unique, non-empty ID. No tools were executed.',
        }
        : null;
    if (invalidToolCallCopy) {
      updateAIChatMessage(sid, currentAsstMsgId, {
        loading: false,
        phase: 'idle',
        tool_calls: undefined,
        excludeFromAIContext: true,
      });
      useStore.getState().addAIChatMessage(sid, {
        id: nextMessageId(),
        role: 'assistant',
        content: translatePanelCopy(
          translate,
          invalidToolCallCopy.key,
          invalidToolCallCopy.fallback,
        ),
        timestamp: Date.now(),
        loading: false,
        excludeFromAIContext: true,
        jvmPlanContext: inheritedJVMPlanContext,
        jvmDiagnosticPlanContext: inheritedJVMDiagnosticPlanContext,
      });
      setSending(false);
      return;
    }
    if (normalizedToolCalls === null) return;

    totalToolRoundRef.current += 1;
    if (totalToolRoundRef.current > MAX_TOOL_CALL_ROUNDS) {
      updateAIChatMessage(sid, currentAsstMsgId, { loading: false, phase: 'idle' });
      useStore.getState().addAIChatMessage(sid, {
        id: nextMessageId(),
        role: 'assistant',
        content: translatePanelCopy(
          translate,
          'ai_chat.panel.probe.max_rounds',
          `⚠️ Tool calls reached the ${MAX_TOOL_CALL_ROUNDS} round limit and were stopped. Send a new message to continue exploring.`,
          { count: MAX_TOOL_CALL_ROUNDS },
        ),
        timestamp: Date.now(),
        excludeFromAIContext: true,
        jvmPlanContext: inheritedJVMPlanContext,
        jvmDiagnosticPlanContext: inheritedJVMDiagnosticPlanContext,
      });
      setSending(false);
      return;
    }

    const results: AIChatMessage[] = [];
    const executions: ExecuteLocalAIToolCallResult[] = [];
    const completedToolCalls: AIToolCall[] = [];
    const currentConnections = useStore.getState().connections;
    for (const toolCall of normalizedToolCalls) {
      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }
      const currentState = useStore.getState();
      const execution = await executeLocalAIToolCall({
        toolCall,
        availableTools,
        connections: currentConnections,
        activeContext: currentState.activeContext,
        aiContexts: currentState.aiContexts,
        aiChatHistory: currentState.aiChatHistory,
        aiChatSessions: currentState.aiChatSessions,
        activeSessionId: sid,
        tabs: resolveLiveQueryTabs(currentState.tabs),
        activeTabId: currentState.activeTabId,
        mcpTools,
        toolContextMap: toolContextMapRef.current,
        sqlLogs: currentState.sqlLogs,
        savedQueries: currentState.savedQueries,
        sqlSnippets: currentState.sqlSnippets,
        externalSQLDirectories: currentState.externalSQLDirectories,
        skills,
        userPromptSettings,
        dynamicModels,
        translate,
      });
      executions.push(execution);
      const toolResultMsg: AIChatMessage = buildToolResultMessage({
        id: nextMessageId(),
        timestamp: Date.now(),
        toolCall,
        execution,
      });
      results.push(toolResultMsg);
      completedToolCalls.push(toolCall);
      useStore.getState().addAIChatMessage(sid, toolResultMsg);
      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }
    }

    const roundCountsAsFailure = executions.length > 0
      && executions.every((execution) => execution.success !== true && execution.countsAsProbeFailure !== false);
    if (!roundCountsAsFailure) {
      toolCallRoundRef.current = 0;
    } else {
      toolCallRoundRef.current += 1;
      if (toolCallRoundRef.current >= 3) {
        updateAIChatMessage(sid, currentAsstMsgId, { loading: false, phase: 'idle' });
        useStore.getState().addAIChatMessage(sid, {
          id: nextMessageId(),
          role: 'assistant',
          content: translatePanelCopy(
            translate,
            'ai_chat.panel.probe.consecutive_failed',
            '⚠️ Probes failed for 3 consecutive rounds and were stopped. Check the connection status and retry.',
          ),
          timestamp: Date.now(),
          excludeFromAIContext: true,
          jvmPlanContext: inheritedJVMPlanContext,
          jvmDiagnosticPlanContext: inheritedJVMDiagnosticPlanContext,
        });
        setSending(false);
        return;
      }
    }

    try {
      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }
      updateAIChatMessage(sid, currentAsstMsgId, { loading: false, phase: 'idle' });

      const chainConnectingMsg: AIChatMessage = {
        id: nextMessageId(),
        role: 'assistant',
        phase: 'connecting',
        content: translatePanelCopy(
          translate,
          'ai_chat.panel.status.summarizing_probe',
          'Summarizing probe results',
        ),
        timestamp: Date.now(),
        loading: true,
        jvmPlanContext: inheritedJVMPlanContext,
        jvmDiagnosticPlanContext: inheritedJVMDiagnosticPlanContext,
      };
      useStore.getState().addAIChatMessage(sid, chainConnectingMsg);

      const safeUpdateTransition = (text: string) => {
        const currentMsg = useStore.getState().aiChatHistory[sid]?.find((message) => message.id === chainConnectingMsg.id);
        if (currentMsg && currentMsg.phase === 'connecting' && currentMsg.loading) {
          updateAIChatMessage(sid, chainConnectingMsg.id, { content: text });
        }
      };

      setTimeout(() => safeUpdateTransition(translatePanelCopy(
        translate,
        'ai_chat.panel.status.returning_runtime_data',
        'Returning runtime data to the model',
      )), 200);
      setTimeout(() => safeUpdateTransition(translatePanelCopy(
        translate,
        'ai_chat.panel.status.deep_reasoning',
        'Model is reasoning deeply',
      )), 500);
      setTimeout(() => safeUpdateTransition(translatePanelCopy(
        translate,
        'ai_chat.panel.status.waiting_instruction',
        'Waiting for operation instructions',
      )), 1200);
      setTimeout(() => safeUpdateTransition(translatePanelCopy(
        translate,
        'ai_chat.panel.status.analyzing_chain',
        'Analyzing chain and logic deeply',
      )), 3000);

      setSending(true);
      const currentHistory = useStore.getState().aiChatHistory[sid] || [];
      const messagesPayload = toAIRequestMessages(
        currentHistory.filter((message) => message.phase !== 'connecting'),
        translate,
      );
      const sysMessages = await buildSystemContextMessages(
        inheritedJVMPlanContext,
        inheritedJVMDiagnosticPlanContext,
      );
      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }

      let finalMessagesPayload = messagesPayload;
      const dynamicMaxLimit = getDynamicMaxContextChars(activeProviderModel);
      const summary = await compressContextIfNeeded(sid, messagesPayload, dynamicMaxLimit, translate);
      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }
      if (summary) {
        const compressedMsg: AIChatMessage = {
          id: nextMessageId(),
          role: 'assistant',
          content: translatePanelCopy(
            translate,
            'ai_chat.panel.status.memory_probe_summary',
            `[Automatic memory reshape] Long probe history and chat have been compressed into a summary:\n\n${summary}`,
            { summary },
          ),
          timestamp: Date.now() - 1000,
        };
        const continueMsg: AIChatMessage = {
          id: nextMessageId(),
          role: 'user',
          content: translatePanelCopy(
            translate,
            'ai_chat.panel.model_control.continue_after_summary',
            'Based on the latest status and exploration results above, continue the analysis you had not finished or perform the next step.',
          ),
          timestamp: Date.now() - 500,
        };
        useStore.getState().replaceAIChatHistory(sid, [compressedMsg, continueMsg, chainConnectingMsg]);
        finalMessagesPayload = [
          { role: 'assistant', content: compressedMsg.content },
          { role: 'user', content: continueMsg.content },
        ];
      }

      const allMessages = [...sysMessages, ...finalMessagesPayload];
      const chainTools = totalToolRoundRef.current >= SOFT_LIMIT_ROUNDS ? [] : availableTools;

      if (await shouldStopAIChatLocalToolRun(sid)) {
        settleStoppedToolRun(completedToolCalls);
        return;
      }
      await dispatchAIChatPayload({
        sid,
        messages: allMessages,
        tools: chainTools,
        sendOptions: sendOptionsRef.current,
        addAIChatMessage: (sessionId, message) => useStore.getState().addAIChatMessage(sessionId, message),
        updateAIChatMessage,
        setSending,
        nextMessageId,
        pendingAssistantMessageId: chainConnectingMsg.id,
        jvmPlanContext: inheritedJVMPlanContext,
        jvmDiagnosticPlanContext: inheritedJVMDiagnosticPlanContext,
        translate,
      });
    } catch (error) {
      console.error('Failed to chain tool call', error);
      setSending(false);
    }
  }, [
    activeProviderModel,
    availableTools,
    buildSystemContextMessages,
    dynamicModels,
    mcpTools,
    nextMessageId,
    pendingJVMDiagnosticPlanContextRef,
    pendingJVMPlanContextRef,
    sendOptionsRef,
    setSending,
    sid,
    skills,
    translate,
    updateAIChatMessage,
    userPromptSettings,
  ]);

  const executeLocalTools = useCallback((
    toolCalls: AIToolCall[],
    currentAsstMsgId: string,
  ): Promise<void> => {
    const finishRun = beginAIChatLocalToolRun(sid);
    return executeLocalToolsInternal(toolCalls, currentAsstMsgId).finally(finishRun);
  }, [executeLocalToolsInternal, sid]);

  return {
    executeLocalTools,
    resetToolCallState,
    toolContextMapRef,
  };
};
