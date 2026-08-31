import { useStore } from '../store';
import { t as translateCatalog, type I18nParams } from '../i18n';

const genCompressionMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
type AIChatRuntimeTranslator = (key: string, params?: I18nParams) => string;

const translateRuntimeCopy = (
  translate: AIChatRuntimeTranslator | undefined,
  key: string,
  fallback: string,
  params?: I18nParams,
): string => {
  const resolved = (translate || translateCatalog)(key, params);
  return resolved && resolved !== key ? resolved : fallback;
};

export const getDynamicMaxContextChars = (modelName?: string) => {
  if (!modelName) return 258000;
  const lower = modelName.toLowerCase();

  if (lower.includes('gemini-1.5-pro') || lower.includes('gemini-2') || lower.includes('gemini-3')) {
    return 5000000;
  }
  if (lower.includes('glm-5') || lower.includes('claude-4') || lower.includes('claude-3.7') || lower.includes('gpt-5') || lower.includes('qwen3') || lower.includes('deepseek-v4')) {
    return 1000000;
  }
  if (lower.includes('claude-3-opus') || lower.includes('claude-3.5') || lower.includes('glm-4-long') || lower.includes('qwen-long')) {
    return 1000000;
  }
  if (lower.includes('claude') || lower.includes('deepseek') || lower.includes('gpt-4.5') || lower.includes('qwen2.5')) {
    return 258000;
  }
  if (lower.includes('gpt-4') || lower.includes('gpt-4o') || lower.includes('glm') || lower.includes('z-ai')) {
    return 128000;
  }
  if (lower.includes('qwen')) {
    return 128000;
  }
  return 258000;
};

export const compressContextIfNeeded = async (
  sid: string,
  messagesPayload: any[],
  maxLimit: number,
  translate?: AIChatRuntimeTranslator,
) => {
  let connectingMsgId: string | null = null;
  const settleCompressionFailure = () => {
    if (!connectingMsgId) return;
    useStore.getState().updateAIChatMessage(sid, connectingMsgId, {
      loading: false,
      phase: 'idle',
      content: translateRuntimeCopy(
        translate,
        'ai_chat.panel.status.memory_compress_failed',
        '❌ Memory compression failed. Continuing with the original context...',
      ),
      excludeFromAIContext: true,
    });
  };

  try {
    const chars = messagesPayload.reduce((sum, message) =>
      sum + (message.content?.length || 0) + (message.reasoning_content?.length || 0) + JSON.stringify(message.tool_calls || []).length, 0);
    if (chars < maxLimit) return null;

    const Service = (window as any).go?.aiservice?.Service;
    if (!Service?.AIChatSend) return null;

    connectingMsgId = genCompressionMessageId();
    useStore.getState().addAIChatMessage(sid, {
      id: connectingMsgId,
      role: 'assistant',
      phase: 'connecting',
      content: translateRuntimeCopy(
        translate,
        'ai_chat.panel.status.memory_compressing',
        '⚙️ Conversation is overloaded. Starting memory compression...',
      ),
      timestamp: Date.now(),
      loading: true,
    });

    const summaryPrompt = translateRuntimeCopy(
      translate,
      'ai_chat.panel.prompt.memory_summary',
      `This is the history of an overlong conversation. To free context space while preserving the core memory, read it carefully and produce a highly condensed structured summary based on technical facts, explored data-structure state, the user's central request, and current progress.
Notes:
1. Be objective and accurate; do not omit key business logic or discovered table names/fields.
2. Remove ineffective execution process, pleasantries, and the JSON return values themselves.
3. Keep it around 1000-2000 words and output concise Markdown only.
4. Start directly with the summary; do not include greetings.`,
    );

    const result = await Service.AIChatSend([
      { role: 'system', content: summaryPrompt },
      ...messagesPayload,
    ]);

    if (result?.success && result.content) {
      useStore.getState().deleteAIChatMessage(sid, connectingMsgId);
      return result.content;
    }

    settleCompressionFailure();
  } catch (error) {
    console.error('Compression exception:', error);
    settleCompressionFailure();
  }
  return null;
};

export const sanitizeErrorMsg = (raw: string, translate?: AIChatRuntimeTranslator): string => {
  if (!raw || typeof raw !== 'string') {
    return translateRuntimeCopy(translate, 'ai_chat.panel.error.unknown', 'Unknown error');
  }
  if (raw.includes('<html') || raw.includes('<!DOCTYPE') || raw.includes('<head')) {
    const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
    const codeMatch = raw.match(/\b(4\d{2}|5\d{2})\b/);
    const title = titleMatch?.[1]?.trim();
    const code = codeMatch?.[1];
    if (title) return code ? `HTTP ${code}: ${title}` : title;
    if (code) {
      return translateRuntimeCopy(
        translate,
        'ai_chat.panel.error.http_server',
        `HTTP ${code} server error`,
        { code },
      );
    }
    return translateRuntimeCopy(
      translate,
      'ai_chat.panel.error.html_response',
      'The server returned an abnormal HTML response, possibly a gateway timeout or unavailable service',
    );
  }
  if (raw.length > 300) {
    return `${raw.substring(0, 280)}${translateRuntimeCopy(
      translate,
      'ai_chat.panel.error.truncated_suffix',
      '...(truncated)',
    )}`;
  }
  return raw;
};
