import type {
  AIChatMessage,
  JVMAIPlanContext,
  JVMDiagnosticPlanContext,
} from '../../types';
import type { AIChatToolDefinition } from '../../utils/aiToolRegistry';
import { sanitizeErrorMsg } from '../../utils/aiChatRuntime';
import { t as translateCatalog, type I18nParams } from '../../i18n';

export interface AIChatSendRequestOptions {
  model?: string;
  thinkingIntensity?: string;
  temperature?: number;
  maxTokens?: number;
}

interface AIChatService {
  AIChatStreamWithOptions?: (
    sid: string,
    messages: any[],
    tools: AIChatToolDefinition[],
    options: AIChatSendRequestOptions,
  ) => Promise<any>;
  AIChatStream?: (sid: string, messages: any[], tools: AIChatToolDefinition[]) => Promise<any>;
  AIChatSendWithOptions?: (
    messages: any[],
    tools: AIChatToolDefinition[],
    options: AIChatSendRequestOptions,
  ) => Promise<any>;
  AIChatSendInSession?: (sid: string, messages: any[], tools: AIChatToolDefinition[]) => Promise<any>;
  AIChatSend?: (messages: any[], tools: AIChatToolDefinition[]) => Promise<any>;
}

interface DispatchAIChatPayloadOptions {
  sid: string;
  messages: any[];
  tools: AIChatToolDefinition[];
  sendOptions?: AIChatSendRequestOptions;
  addAIChatMessage: (sid: string, message: AIChatMessage) => void;
  updateAIChatMessage?: (
    sid: string,
    messageId: string,
    patch: Partial<AIChatMessage>,
  ) => void;
  setSending: (sending: boolean) => void;
  nextMessageId: () => string;
  pendingAssistantMessageId?: string;
  jvmPlanContext?: JVMAIPlanContext;
  jvmDiagnosticPlanContext?: JVMDiagnosticPlanContext;
  unavailableContent?: string;
  translate?: (key: string, params?: I18nParams) => string;
  onNonStreamSuccess?: () => void;
}

const getAIChatService = (): AIChatService | undefined =>
  (window as any)?.go?.aiservice?.Service;

const settleAssistantMessage = ({
  sid,
  patch,
  addAIChatMessage,
  updateAIChatMessage,
  nextMessageId,
  pendingAssistantMessageId,
}: {
  sid: string;
  patch: Partial<AIChatMessage>;
  addAIChatMessage: (sid: string, message: AIChatMessage) => void;
  updateAIChatMessage?: (
    sid: string,
    messageId: string,
    patch: Partial<AIChatMessage>,
  ) => void;
  nextMessageId: () => string;
  pendingAssistantMessageId?: string;
}) => {
  const settledPatch: Partial<AIChatMessage> = {
    ...patch,
    loading: false,
    phase: 'idle',
  };

  if (pendingAssistantMessageId && updateAIChatMessage) {
    updateAIChatMessage(sid, pendingAssistantMessageId, settledPatch);
    return;
  }

  addAIChatMessage(sid, {
    id: nextMessageId(),
    role: 'assistant',
    timestamp: Date.now(),
    ...settledPatch,
  } as AIChatMessage);
};

export const dispatchAIChatPayload = async ({
  sid,
  messages,
  tools,
  sendOptions,
  addAIChatMessage,
  updateAIChatMessage,
  setSending,
  nextMessageId,
  pendingAssistantMessageId,
  jvmPlanContext,
  jvmDiagnosticPlanContext,
  unavailableContent,
  translate = (key, params) => translateCatalog(key, params, 'en-US'),
  onNonStreamSuccess,
}: DispatchAIChatPayloadOptions): Promise<'stream' | 'send' | 'unavailable' | 'error'> => {
  try {
    const service = getAIChatService();
    const requestOptions: AIChatSendRequestOptions = {
      model: String(sendOptions?.model || '').trim() || undefined,
      thinkingIntensity: String(sendOptions?.thinkingIntensity || '').trim() || undefined,
      temperature: sendOptions?.temperature,
      maxTokens: sendOptions?.maxTokens,
    };
    if (service?.AIChatStreamWithOptions) {
      await service.AIChatStreamWithOptions(sid, messages, tools, requestOptions);
      return 'stream';
    }
    if (service?.AIChatStream) {
      await service.AIChatStream(sid, messages, tools);
      return 'stream';
    }

    if (service?.AIChatSendWithOptions) {
      const result = await service.AIChatSendWithOptions(messages, tools, requestOptions);
      const rawError = result?.error || translate('common.unknown');
      const cleanError = sanitizeErrorMsg(rawError, translate);

      settleAssistantMessage({
        sid,
        addAIChatMessage,
        updateAIChatMessage,
        nextMessageId,
        pendingAssistantMessageId,
        patch: {
          content: result?.success ? result.content : `❌ ${cleanError}`,
          thinking: result?.success ? result.reasoning_content : undefined,
          reasoning_content: result?.success ? result.reasoning_content : undefined,
          rawError: !result?.success && cleanError !== rawError ? rawError : undefined,
          excludeFromAIContext: result?.success ? undefined : true,
          jvmPlanContext,
          jvmDiagnosticPlanContext,
        },
      });
      if (result?.success) {
        onNonStreamSuccess?.();
      }
      setSending(false);
      return 'send';
    }

    if (service?.AIChatSendInSession || service?.AIChatSend) {
      const result = service?.AIChatSendInSession
        ? await service.AIChatSendInSession(sid, messages, tools)
        : await service!.AIChatSend!(messages, tools);
      const rawError = result?.error || translate('common.unknown');
      const cleanError = sanitizeErrorMsg(rawError, translate);

      settleAssistantMessage({
        sid,
        addAIChatMessage,
        updateAIChatMessage,
        nextMessageId,
        pendingAssistantMessageId,
        patch: {
          content: result?.success ? result.content : `❌ ${cleanError}`,
          thinking: result?.success ? result.reasoning_content : undefined,
          reasoning_content: result?.success ? result.reasoning_content : undefined,
          rawError: !result?.success && cleanError !== rawError ? rawError : undefined,
          excludeFromAIContext: result?.success ? undefined : true,
          jvmPlanContext,
          jvmDiagnosticPlanContext,
        },
      });
      setSending(false);
      if (result?.success) {
        onNonStreamSuccess?.();
      }
      return 'send';
    }

    const resolvedUnavailableContent = unavailableContent || (pendingAssistantMessageId ? translate('ai_chat.panel.message.service_not_ready') : '');
    if (resolvedUnavailableContent) {
      settleAssistantMessage({
        sid,
        addAIChatMessage,
        updateAIChatMessage,
        nextMessageId,
        pendingAssistantMessageId,
        patch: {
          content: resolvedUnavailableContent,
          excludeFromAIContext: true,
          jvmPlanContext,
          jvmDiagnosticPlanContext,
        },
      });
    }
    setSending(false);
    return 'unavailable';
  } catch (error: any) {
    const rawError = error?.message || String(error);
    const cleanError = sanitizeErrorMsg(rawError, translate);
    settleAssistantMessage({
      sid,
      addAIChatMessage,
      updateAIChatMessage,
      nextMessageId,
      pendingAssistantMessageId,
      patch: {
        content: translate('ai_chat.panel.message.send_failed', { detail: cleanError }),
        rawError: cleanError !== rawError ? rawError : undefined,
        excludeFromAIContext: true,
        jvmPlanContext,
        jvmDiagnosticPlanContext,
      },
    });
    setSending(false);
    return 'error';
  }
};
