import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { EventsOn, EventsOff } from '../../../wailsjs/runtime';
import { useStore } from '../../store';
import type {
  AIChatMessage,
  AIToolCall,
  JVMAIPlanContext,
  JVMDiagnosticPlanContext,
} from '../../types';
import { sanitizeErrorMsg } from '../../utils/aiChatRuntime';
import {
  stripLeakedToolCallMarkup,
  toAIRequestMessages,
} from '../../utils/aiMessagePayload';
import type { AIChatToolDefinition } from '../../utils/aiToolRegistry';
import type { AIChatAttachmentTranslator } from './aiChatAttachments';
import {
  dispatchAIChatPayload,
  type AIChatSendRequestOptions,
} from './aiChatPayloadDispatch';
import {
  beginAIChatLocalToolRun,
  beginAIChatLocalToolTerminalStop,
  shouldStopAIChatLocalToolRun,
} from './aiChatLocalToolLifecycle';

interface AIChatStreamChunk {
  content?: string;
  thinking?: string;
  reasoning_content?: string;
  tool_calls?: AIToolCall[];
  done?: boolean;
  error?: string;
}

interface UseAIChatStreamSubscriptionOptions {
  sid: string;
  sending: boolean;
  setSending: (sending: boolean) => void;
  availableTools: AIChatToolDefinition[];
  addAIChatMessage: (sid: string, message: AIChatMessage) => void;
  updateAIChatMessage: (
    sid: string,
    messageId: string,
    patch: Partial<AIChatMessage>,
  ) => void;
  buildSystemContextMessages: (
    overrideJVMPlanContext?: JVMAIPlanContext,
    overrideJVMDiagnosticPlanContext?: JVMDiagnosticPlanContext,
  ) => any[] | Promise<any[]>;
  executeLocalTools: (toolCalls: AIToolCall[], currentAsstMsgId: string) => void | Promise<void>;
  generateTitleForSession: (sid: string) => void | Promise<void>;
  nextMessageId: () => string;
  nudgeCountRef: MutableRefObject<number>;
  pendingJVMPlanContextRef: MutableRefObject<JVMAIPlanContext | undefined>;
  pendingJVMDiagnosticPlanContextRef: MutableRefObject<JVMDiagnosticPlanContext | undefined>;
  sendOptionsRef: MutableRefObject<AIChatSendRequestOptions>;
  translate?: AIChatAttachmentTranslator;
}

interface AIChatStreamState {
  sid: string;
  assistantMsgId: string;
  isFirstCompletion: boolean;
  streamBuffer: {
    thinking: string;
    reasoningContent: string;
    content: string;
  };
  flushPending: boolean;
  lastFlushAt: number | null;
}

const AI_CHAT_STREAM_FLUSH_INTERVAL_MS = 80;
const activeAIChatStreamFlushers = new Map<string, () => void>();
const activeAIChatStreamFinalizers = new Map<string, () => void>();

type AIChatTerminalService = {
  AIChatCancelAllAndWait?: () => Promise<boolean>;
  AIChatCancelAndWait?: (sid: string) => Promise<boolean>;
  AIChatCancel?: (sid: string) => Promise<unknown>;
};

type PrepareAIChatStreamForTerminalActionOptions = {
  sid: string;
  service?: AIChatTerminalService;
  setSending: (sending: boolean) => void;
  settleDelayMs?: number;
  allSessions?: boolean;
};

export const flushAIChatStreamBuffers = (sessionIds?: string[]): void => {
  const targetIds = sessionIds
    ? new Set(sessionIds.map((id) => String(id || '').trim()).filter(Boolean))
    : null;
  for (const [sessionId, flush] of activeAIChatStreamFlushers) {
    if (!targetIds || targetIds.has(sessionId)) flush();
  }
};

export const settleAIChatLoadingAssistantMessages = (sid: string): void => {
  const sessionId = String(sid || '').trim();
  if (!sessionId) return;
  const state = useStore.getState();
  const messages = state.aiChatHistory[sessionId] || [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.loading) {
      const originalContent = message.content || '';
      const repairedContent = stripLeakedToolCallMarkup(originalContent);
      const hasPartialResponse = message.phase !== 'connecting' && Boolean(
        repairedContent.trim()
        || message.thinking?.trim()
        || message.reasoning_content?.trim(),
      );

      if (hasPartialResponse) {
        state.updateAIChatMessage(sessionId, message.id, {
          ...(repairedContent !== originalContent ? { content: repairedContent } : {}),
          loading: false,
          phase: 'idle',
          tool_calls: undefined,
        });
      } else {
        state.deleteAIChatMessage(sessionId, message.id);
      }
    }
  }
};

export const settleAllAIChatLoadingAssistantMessages = (): void => {
  const sessionIds = Object.keys(useStore.getState().aiChatHistory);
  for (const sessionId of sessionIds) {
    settleAIChatLoadingAssistantMessages(sessionId);
  }
};

const finalizeAIChatStreamProgress = (sessionIds?: string[]): void => {
  const targetIds = sessionIds
    ? new Set(sessionIds.map((id) => String(id || '').trim()).filter(Boolean))
    : null;
  for (const [sessionId, finalize] of activeAIChatStreamFinalizers) {
    if (!targetIds || targetIds.has(sessionId)) finalize();
  }
};

export const prepareAIChatStreamForTerminalAction = async ({
  sid,
  service,
  setSending,
  settleDelayMs = 60,
  allSessions = false,
}: PrepareAIChatStreamForTerminalActionOptions): Promise<boolean> => {
  const terminalSessionIds = allSessions
    ? Object.keys(useStore.getState().aiChatHistory)
    : [sid];
  const localToolStop = beginAIChatLocalToolTerminalStop(terminalSessionIds);

  try {
    if (allSessions && typeof service?.AIChatCancelAllAndWait === 'function') {
      const stopped = await service.AIChatCancelAllAndWait();
      if (stopped === false) {
        localToolStop.rollback();
        return false;
      }
    } else if (typeof service?.AIChatCancelAndWait === 'function') {
      const stopped = await service.AIChatCancelAndWait(sid);
      if (stopped === false) {
        localToolStop.rollback();
        return false;
      }
    } else if (typeof service?.AIChatCancel === 'function') {
      await service.AIChatCancel(sid);
    }
    localToolStop.commit();
  } catch (error) {
    localToolStop.rollback();
    throw error;
  }

  if (settleDelayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, settleDelayMs));
  }
  flushAIChatStreamBuffers(allSessions ? undefined : [sid]);
  finalizeAIChatStreamProgress(allSessions ? undefined : [sid]);
  await localToolStop.waitForIdle();
  if (allSessions) {
    settleAllAIChatLoadingAssistantMessages();
  } else {
    settleAIChatLoadingAssistantMessages(sid);
  }
  setSending(false);
  return true;
};

const createAIChatStreamState = (sid: string): AIChatStreamState => ({
  sid,
  assistantMsgId: '',
  isFirstCompletion: false,
  streamBuffer: { thinking: '', reasoningContent: '', content: '' },
  flushPending: false,
  lastFlushAt: null,
});

const resetAIChatStreamProgress = (state: AIChatStreamState) => {
  state.assistantMsgId = '';
  state.isFirstCompletion = false;
  state.streamBuffer.thinking = '';
  state.streamBuffer.reasoningContent = '';
  state.streamBuffer.content = '';
  state.flushPending = false;
  state.lastFlushAt = null;
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

const FORCE_TOOL_CALL_NUDGE_PATTERNS = [
  /(?:let me|i(?:'|’)ll|i will|first|next|now).*(?:query|search|find|fetch|get|check|inspect|review|look up|call)/i,
  /(?:query|search|find|fetch|get|check|inspect|review|look up).*(?:info(?:rmation)?|field|fields|column|columns|list|data)\s*[:：]?\s*$/i,
  /(?:\u8ba9\u6211|\u6211\u5148|\u6211\u6765|\u73b0\u5728|\u63a5\u4e0b\u6765|\u4e0b\u9762).*(?:\u67e5\u8be2|\u67e5\u627e|\u83b7\u53d6|\u67e5\u770b|\u68c0\u67e5|\u8c03\u7528)|(?:\u83b7\u53d6|\u67e5\u8be2|\u67e5\u627e|\u67e5\u770b).*(?:\u4fe1\u606f|\u5b57\u6bb5|\u5217\u8868|\u6570\u636e)[：:]?\s*$/u,
  /(?:\u8b93\u6211|\u6211\u5148|\u6211\u4f86|\u73fe\u5728|\u63a5\u4e0b\u4f86|\u4e0b\u9762).*(?:\u67e5\u8a62|\u67e5\u627e|\u7372\u53d6|\u67e5\u770b|\u6aa2\u67e5|\u8abf\u7528)|(?:\u7372\u53d6|\u67e5\u8a62|\u67e5\u627e|\u67e5\u770b).*(?:\u8cc7\u8a0a|\u5b57\u6bb5|\u6b04\u4f4d|\u5217\u8868|\u8cc7\u6599)[：:]?\s*$/u,
];

const shouldResendForceToolCallNudge = (content: string): boolean => {
  const text = String(content || '').trim();
  return text !== '' && FORCE_TOOL_CALL_NUDGE_PATTERNS.some((pattern) => pattern.test(text));
};

export const useAIChatStreamSubscription = ({
  sid,
  sending,
  setSending,
  availableTools,
  addAIChatMessage,
  updateAIChatMessage,
  buildSystemContextMessages,
  executeLocalTools,
  generateTitleForSession,
  nextMessageId,
  nudgeCountRef,
  pendingJVMPlanContextRef,
  pendingJVMDiagnosticPlanContextRef,
  sendOptionsRef,
  translate,
}: UseAIChatStreamSubscriptionOptions) => {
  const streamStateRef = useRef(createAIChatStreamState(sid));
  const optionsRef = useRef<UseAIChatStreamSubscriptionOptions>({
    sid,
    sending,
    setSending,
    availableTools,
    addAIChatMessage,
    updateAIChatMessage,
    buildSystemContextMessages,
    executeLocalTools,
    generateTitleForSession,
    nextMessageId,
    nudgeCountRef,
    pendingJVMPlanContextRef,
    pendingJVMDiagnosticPlanContextRef,
    sendOptionsRef,
    translate,
  });
  optionsRef.current = {
    sid,
    sending,
    setSending,
    availableTools,
    addAIChatMessage,
    updateAIChatMessage,
    buildSystemContextMessages,
    executeLocalTools,
    generateTitleForSession,
    nextMessageId,
    nudgeCountRef,
    pendingJVMPlanContextRef,
    pendingJVMDiagnosticPlanContextRef,
    sendOptionsRef,
    translate,
  };

  useEffect(() => {
    const eventName = `ai:stream:${sid}`;
    const addAIChatMessage: UseAIChatStreamSubscriptionOptions['addAIChatMessage'] =
      (...args) => optionsRef.current.addAIChatMessage(...args);
    const updateAIChatMessage: UseAIChatStreamSubscriptionOptions['updateAIChatMessage'] =
      (...args) => optionsRef.current.updateAIChatMessage(...args);
    const buildSystemContextMessages: UseAIChatStreamSubscriptionOptions['buildSystemContextMessages'] =
      (...args) => optionsRef.current.buildSystemContextMessages(...args);
    const executeLocalTools: UseAIChatStreamSubscriptionOptions['executeLocalTools'] =
      (...args) => optionsRef.current.executeLocalTools(...args);
    const generateTitleForSession: UseAIChatStreamSubscriptionOptions['generateTitleForSession'] =
      (...args) => optionsRef.current.generateTitleForSession(...args);
    const nextMessageId = () => optionsRef.current.nextMessageId();
    const setSending = (nextSending: boolean) => optionsRef.current.setSending(nextSending);
    const translate: AIChatAttachmentTranslator = (key, params) =>
      optionsRef.current.translate?.(key, params) ?? key;
    const nudgeCountRef = optionsRef.current.nudgeCountRef;
    const pendingJVMPlanContextRef = optionsRef.current.pendingJVMPlanContextRef;
    const pendingJVMDiagnosticPlanContextRef =
      optionsRef.current.pendingJVMDiagnosticPlanContextRef;
    if (streamStateRef.current.sid !== sid) {
      streamStateRef.current = createAIChatStreamState(sid);
    }
    const streamState = streamStateRef.current;

    // 缓冲高频 token，避免把流式吞吐直接转成同步重绘风暴
    const streamBuffer = streamState.streamBuffer;
    let flushTimerId: ReturnType<typeof setTimeout> | null = null;
    let completionTimerId: ReturnType<typeof setTimeout> | null = null;
    let pendingLocalToolTimerId: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const cancelScheduledFlush = () => {
      if (flushTimerId !== null) {
        clearTimeout(flushTimerId);
        flushTimerId = null;
      }
      streamState.flushPending = false;
    };

    const flushStreamBuffer = () => {
      streamState.flushPending = false;
      flushTimerId = null;
      if (!streamState.assistantMsgId) return;
      const current = useStore.getState().aiChatHistory[sid];
      const existing = current?.find((message) => message.id === streamState.assistantMsgId);
      if (!existing) return;

      const updates: Partial<AIChatMessage> = {};
      if (streamBuffer.thinking) {
        updates.thinking = (existing.thinking || '') + streamBuffer.thinking;
        updates.phase = 'thinking';
        streamBuffer.thinking = '';
      }
      if (streamBuffer.reasoningContent) {
        updates.reasoning_content = (existing.reasoning_content || '') + streamBuffer.reasoningContent;
        streamBuffer.reasoningContent = '';
      }
      if (streamBuffer.content) {
        updates.content = (existing.content || '') + streamBuffer.content;
        updates.phase = 'generating';
        streamBuffer.content = '';
      }

      if (Object.keys(updates).length > 0) {
        updateAIChatMessage(sid, streamState.assistantMsgId, updates);
        streamState.lastFlushAt = Date.now();
      }
    };
    activeAIChatStreamFlushers.set(sid, flushStreamBuffer);
    const finalizeStream = () => {
      cancelScheduledFlush();
      if (completionTimerId !== null) {
        clearTimeout(completionTimerId);
        completionTimerId = null;
      }
      if (pendingLocalToolTimerId !== null) {
        clearTimeout(pendingLocalToolTimerId);
        pendingLocalToolTimerId = null;
      }
      resetAIChatStreamProgress(streamState);
    };
    activeAIChatStreamFinalizers.set(sid, finalizeStream);

    const scheduleStreamFlush = () => {
      if (streamState.flushPending) return;
      streamState.flushPending = true;

      const lastFlushAt = streamState.lastFlushAt;
      const delay =
        lastFlushAt === null
          ? AI_CHAT_STREAM_FLUSH_INTERVAL_MS
          : Math.max(0, AI_CHAT_STREAM_FLUSH_INTERVAL_MS - (Date.now() - lastFlushAt));

      flushTimerId = setTimeout(flushStreamBuffer, delay);
    };

    const handler = (data: AIChatStreamChunk) => {
      if (!streamState.assistantMsgId) {
        const history = useStore.getState().aiChatHistory[sid] || [];
        const lastMsg = history[history.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.loading && lastMsg.phase === 'connecting') {
          streamState.assistantMsgId = lastMsg.id;
          updateAIChatMessage(sid, streamState.assistantMsgId, { content: '' });
        }
      }

      if (data.error) {
        cancelScheduledFlush();
        flushStreamBuffer();

        const cleanErr = sanitizeErrorMsg(data.error, translate);
        const rawErr = cleanErr !== data.error ? data.error : undefined;
        if (streamState.assistantMsgId) {
          const failedAssistantId = streamState.assistantMsgId;
          const failedAssistant = (useStore.getState().aiChatHistory[sid] || [])
            .find((message) => message.id === failedAssistantId);
          const failedAssistantContent = failedAssistant?.content || '';
          const repairedContent = stripLeakedToolCallMarkup(failedAssistantContent);
          const hasPartialResponse = Boolean(
            repairedContent.trim()
            || failedAssistant?.thinking?.trim()
            || failedAssistant?.reasoning_content?.trim(),
          );

          if (failedAssistant && hasPartialResponse) {
            updateAIChatMessage(sid, failedAssistantId, {
              ...(repairedContent !== failedAssistantContent ? { content: repairedContent } : {}),
              phase: 'idle',
              loading: false,
              tool_calls: undefined,
            });
          } else if (failedAssistant) {
            useStore.getState().deleteAIChatMessage(sid, failedAssistantId);
          }
        }

        addAIChatMessage(sid, {
          id: nextMessageId(),
          role: 'assistant',
          phase: 'idle',
          content: translatePanelCopy(
            translate,
            'ai_chat.panel.message.error',
            `❌ Error: ${cleanErr}`,
            { detail: cleanErr },
          ),
          rawError: rawErr,
          excludeFromAIContext: true,
          timestamp: Date.now(),
          loading: false,
          jvmPlanContext: pendingJVMPlanContextRef.current,
          jvmDiagnosticPlanContext: pendingJVMDiagnosticPlanContextRef.current,
        });
        resetAIChatStreamProgress(streamState);
        setSending(false);
        return;
      }

      if (data.tool_calls && data.tool_calls.length > 0) {
        if (streamState.assistantMsgId) {
          updateAIChatMessage(sid, streamState.assistantMsgId, { tool_calls: data.tool_calls, phase: 'tool_calling' });
        } else {
          streamState.assistantMsgId = nextMessageId();
          addAIChatMessage(sid, {
            id: streamState.assistantMsgId,
            role: 'assistant',
            phase: 'tool_calling',
            content: '',
            tool_calls: data.tool_calls,
            timestamp: Date.now(),
            loading: true,
            jvmPlanContext: pendingJVMPlanContextRef.current,
            jvmDiagnosticPlanContext: pendingJVMDiagnosticPlanContextRef.current,
          });
        }
      }

      const displayThinking = data.thinking || data.reasoning_content || '';
      if (displayThinking || data.reasoning_content) {
        if (!streamState.assistantMsgId) {
          streamState.assistantMsgId = nextMessageId();
          addAIChatMessage(sid, {
            id: streamState.assistantMsgId,
            role: 'assistant',
            phase: 'thinking',
            content: '',
            thinking: displayThinking || undefined,
            reasoning_content: data.reasoning_content || undefined,
            timestamp: Date.now(),
            loading: true,
            jvmPlanContext: pendingJVMPlanContextRef.current,
            jvmDiagnosticPlanContext: pendingJVMDiagnosticPlanContextRef.current,
          });
        } else {
          streamBuffer.thinking += displayThinking;
          if (data.reasoning_content) {
            streamBuffer.reasoningContent += data.reasoning_content;
          }
        }
      }

      if (data.content) {
        if (!streamState.assistantMsgId) {
          streamState.assistantMsgId = nextMessageId();
          addAIChatMessage(sid, {
            id: streamState.assistantMsgId,
            role: 'assistant',
            phase: 'generating',
            content: data.content,
            timestamp: Date.now(),
            loading: true,
            jvmPlanContext: pendingJVMPlanContextRef.current,
            jvmDiagnosticPlanContext: pendingJVMDiagnosticPlanContextRef.current,
          });
          const currentHistory = useStore.getState().aiChatHistory[sid] || [];
          if (currentHistory.length <= 1) streamState.isFirstCompletion = true;
        } else {
          streamBuffer.content += data.content;
        }
      }

      if (streamBuffer.thinking || streamBuffer.reasoningContent || streamBuffer.content) {
        scheduleStreamFlush();
      }

      if (data.done) {
        if (streamBuffer.thinking || streamBuffer.reasoningContent || streamBuffer.content) {
          cancelScheduledFlush();
          flushStreamBuffer();
        }
        const doneAssistantId = streamState.assistantMsgId;
        const doneIsFirst = streamState.isFirstCompletion;
        resetAIChatStreamProgress(streamState);
        if (completionTimerId !== null) clearTimeout(completionTimerId);
        completionTimerId = setTimeout(() => {
          completionTimerId = null;
          if (disposed) return;
          const currentMsgs = useStore.getState().aiChatHistory[sid] || [];
          for (const msg of currentMsgs) {
            if (msg.id !== doneAssistantId && msg.loading && msg.phase === 'connecting') {
              updateAIChatMessage(sid, msg.id, { loading: false, phase: 'idle' });
            }
          }

          if (doneAssistantId) {
            const current = useStore.getState().aiChatHistory[sid];
            const existing = current?.find((message) => message.id === doneAssistantId);
            if (existing && existing.tool_calls && existing.tool_calls.length > 0) {
              nudgeCountRef.current = 0;
              pendingLocalToolTimerId = setTimeout(() => {
                pendingLocalToolTimerId = null;
                if (disposed) return;
                void executeLocalTools(existing.tool_calls!, doneAssistantId);
              }, 50);
              return;
            }

            const existingContent = existing?.content || '';
            const repairedContent = stripLeakedToolCallMarkup(existingContent);
            const hasLeakedToolCallMarkup = repairedContent !== existingContent;
            if (existing && hasLeakedToolCallMarkup) {
              updateAIChatMessage(sid, doneAssistantId, { content: repairedContent });
            }
            if (
              existing &&
              nudgeCountRef.current < 2 &&
              (hasLeakedToolCallMarkup || shouldResendForceToolCallNudge(existingContent))
            ) {
              nudgeCountRef.current += 1;
              updateAIChatMessage(sid, doneAssistantId, {
                ...(hasLeakedToolCallMarkup ? { content: repairedContent } : {}),
                loading: false,
                phase: 'idle',
              });
              const finishNudgeRun = beginAIChatLocalToolRun(sid);
              (async () => {
                try {
                  if (disposed || await shouldStopAIChatLocalToolRun(sid)) return;
                  const currentHistory = useStore.getState().aiChatHistory[sid] || [];
                  const messagesPayload = toAIRequestMessages(currentHistory, translate);
                  const sysMessages = await buildSystemContextMessages(
                    existing.jvmPlanContext,
                    existing.jvmDiagnosticPlanContext,
                  );
                  if (disposed || await shouldStopAIChatLocalToolRun(sid)) return;
                  messagesPayload.push({
                    role: 'user',
                    content: translatePanelCopy(
                      translate,
                      'ai_chat.panel.model_control.force_tool_call',
                      'Use a function call directly to invoke the tool and perform the operation; do not only describe the plan in text.',
                    ),
                  });
                  const allMsg = [...sysMessages, ...messagesPayload];
                  await dispatchAIChatPayload({
                    sid,
                    messages: allMsg,
                    tools: optionsRef.current.availableTools,
                    sendOptions: optionsRef.current.sendOptionsRef.current,
                    addAIChatMessage,
                    updateAIChatMessage,
                    setSending,
                    nextMessageId,
                    jvmPlanContext: existing.jvmPlanContext,
                    jvmDiagnosticPlanContext: existing.jvmDiagnosticPlanContext,
                    translate,
                  });
                } catch (error) {
                  console.error('Nudge failed', error);
                  setSending(false);
                } finally {
                  finishNudgeRun();
                }
              })();
              return;
            }

            if (doneIsFirst) generateTitleForSession(sid);

            const visibleContent = hasLeakedToolCallMarkup ? repairedContent : existing?.content;
            const hasContent = !!visibleContent?.trim();
            const hasThinking = !!existing?.thinking?.trim();
            const hasTools = !!existing?.tool_calls?.length;

            if (!hasContent && !hasThinking && !hasTools) {
              updateAIChatMessage(sid, doneAssistantId, {
                content: translatePanelCopy(
                  translate,
                  'ai_chat.panel.message.empty_response',
                  '❌ The model did not return any content. It may have hit rate limits, context overload, or a refusal.',
                ),
                loading: false,
                phase: 'idle',
                excludeFromAIContext: true,
              });
            } else {
              updateAIChatMessage(sid, doneAssistantId, { loading: false, phase: 'idle' });
            }
          } else {
            addAIChatMessage(sid, {
              id: nextMessageId(),
              role: 'assistant',
              content: translatePanelCopy(
                translate,
                'ai_chat.panel.message.request_interrupted',
                '❌ Request interrupted: no concrete reply was received.',
              ),
              timestamp: Date.now(),
              loading: false,
              excludeFromAIContext: true,
            });
          }
          setSending(false);
        }, 50);
      }
    };

    EventsOn(eventName, handler);
    return () => {
      disposed = true;
      cancelScheduledFlush();
      flushStreamBuffer();
      finalizeStream();
      if (activeAIChatStreamFlushers.get(sid) === flushStreamBuffer) {
        activeAIChatStreamFlushers.delete(sid);
      }
      if (activeAIChatStreamFinalizers.get(sid) === finalizeStream) {
        activeAIChatStreamFinalizers.delete(sid);
      }
      EventsOff(eventName);
    };
  }, [sid]);
};
