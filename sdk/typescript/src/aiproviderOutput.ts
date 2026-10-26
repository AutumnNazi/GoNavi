import type { AIProviderCompletion, AIProviderDelta, AIProviderUsage } from './aiproviderTypes.js';
import { AIProviderFault, boundedJSON, fault, integer, keys, text, toolCalls } from './aiproviderValidation.js';

function output<T>(validate: () => T): T {
  try { return validate(); }
  catch (error: unknown) {
    fault(error instanceof AIProviderFault && ['limit_exceeded', 'unsupported'].includes(error.kind) ? error.kind : 'generation_failed');
  }
}

export function delta(input: unknown, maxBytes: number): AIProviderDelta {
  return output(() => {
    const value = boundedJSON(input, maxBytes, 'generation_failed');
    keys(value, ['content', 'reasoningContent']);
    if (('content' in value && !text(value.content, maxBytes, false, true)) ||
        ('reasoningContent' in value && !text(value.reasoningContent, maxBytes, false, true)) ||
        (!value.content && !value.reasoningContent)) fault('generation_failed');
    return { ...('content' in value ? { content: value.content as string } : {}),
      ...('reasoningContent' in value ? { reasoningContent: value.reasoningContent as string } : {}) };
  });
}

function usage(input: unknown): AIProviderUsage {
  keys(input, ['promptTokens', 'completionTokens', 'totalTokens', 'cachedTokens'], ['promptTokens', 'completionTokens', 'totalTokens']);
  if (!integer(input.promptTokens, 0, Number.MAX_SAFE_INTEGER) || !integer(input.completionTokens, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(input.totalTokens, 0, Number.MAX_SAFE_INTEGER) || ('cachedTokens' in input && !integer(input.cachedTokens, 0, Number.MAX_SAFE_INTEGER))) fault('generation_failed');
  return { promptTokens: input.promptTokens, completionTokens: input.completionTokens, totalTokens: input.totalTokens,
    ...('cachedTokens' in input ? { cachedTokens: input.cachedTokens as number } : {}) };
}

export function completion(input: unknown, maxBytes: number, supportsTools: boolean, offered: ReadonlySet<string>): AIProviderCompletion {
  return output(() => {
    const value = boundedJSON(input, maxBytes, 'generation_failed');
    keys(value, ['finishReason', 'toolCalls', 'usage'], ['finishReason']);
    if (value.finishReason !== 'stop' && value.finishReason !== 'tool_calls' && value.finishReason !== 'length') fault('generation_failed');
    if (Array.isArray(value.toolCalls) && value.toolCalls.length && !supportsTools) fault('unsupported');
    const calls = 'toolCalls' in value ? toolCalls(value.toolCalls, offered) : undefined;
    if ((value.finishReason === 'tool_calls' && !calls?.length) || (value.finishReason === 'stop' && Boolean(calls?.length))) fault('generation_failed');
    return { finishReason: value.finishReason, ...(calls === undefined ? {} : { toolCalls: calls }),
      ...('usage' in value ? { usage: usage(value.usage) } : {}) };
  });
}
