import type { AIChatMessage, AIToolCall } from '../../types';

export type AIToolResultIndex = ReadonlyMap<string, AIChatMessage>;

export const buildAIToolResultIndex = (
  messages: readonly AIChatMessage[],
): AIToolResultIndex => {
  const toolResultsById = new Map<string, AIChatMessage>();
  for (const message of messages) {
    if (message.role === 'tool' && message.tool_call_id) {
      toolResultsById.set(message.tool_call_id, message);
    }
  }
  return toolResultsById;
};

export const haveSameRelevantToolResults = (
  toolCalls: readonly AIToolCall[] | undefined,
  previous: AIToolResultIndex,
  next: AIToolResultIndex,
): boolean => {
  if (previous === next || !toolCalls || toolCalls.length === 0) {
    return true;
  }
  return toolCalls.every((toolCall) => (
    previous.get(toolCall.id) === next.get(toolCall.id)
  ));
};
