import type { AIModel, JSONValue } from './types.js';

export const AI_PROVIDER_PROTOCOL_VERSION = 1;
export type AIProviderErrorCode = 'canceled' | 'deadline' | 'unsupported' | 'invalid_request' | 'generation_failed' | 'limit_exceeded';
export type AIProviderFinishReason = 'stop' | 'tool_calls' | 'length';
export type AIProviderToolCall = {
  id: string; type: 'function'; function: { name: string; arguments: string };
};
export type AIProviderTool = {
  type: 'function'; function: { name: string; description: string; parameters: { [key: string]: JSONValue } };
};
export type AIProviderMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'; content: string;
  reasoning_content?: string; tool_call_id?: string; tool_calls?: AIProviderToolCall[];
  /** Bounded base64 data URLs; user messages only, and only for declared image providers. */
  images?: string[];
};
/** Only selected credentials are supplied. Never log this value. */
export type AIProviderConfig = { baseUrl: string; apiKey: string; model: string; headers?: Record<string, string> };
export type AIProviderRequest = {
  messages: AIProviderMessage[]; temperature: number; maxTokens: number; tools?: AIProviderTool[];
};
export type AIProviderStart = {
  protocolVersion: 1; operation: 'start'; providerId: string; requestId: string;
  config: AIProviderConfig; request: AIProviderRequest;
};
export type AIProviderControl = {
  protocolVersion: 1; operation: 'pull' | 'cancel'; providerId: string; requestId: string;
};
export type AIProviderDelta = { content?: string; reasoningContent?: string };
export type AIProviderUsage = { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
export type AIProviderCompletion = { finishReason: AIProviderFinishReason; toolCalls?: AIProviderToolCall[]; usage?: AIProviderUsage };
export type AIProviderEvent =
  | ({ sequence: number; type: 'delta' } & AIProviderDelta)
  | ({ sequence: number; type: 'done' } & AIProviderCompletion)
  | { sequence: number; type: 'error'; code: AIProviderErrorCode };
/** Await each emit. Overlapping blocked emits are rejected rather than building an unbounded waiter list. */
export type AIProviderEmit = (delta: AIProviderDelta) => Promise<void>;
/** Join all producer work before resolving; never retain emit or launch detached producer tasks. */
export type AIProviderGenerate = (start: AIProviderStart, signal: AbortSignal, emit: AIProviderEmit) => Promise<AIProviderCompletion>;
export interface AIProviderRegistration {
  models: readonly Readonly<AIModel>[]; supportsTools: boolean; supportsImages: boolean; generate: AIProviderGenerate;
}
export interface AIProviderLimits {
  maxWorkers: number; maxSessions: number; maxTombstones: number; maxRequestBytes: number;
  maxEventBytes: number; maxPullBytes: number; maxPullEvents: number;
  maxQueueBytes: number; maxQueueEvents: number; maxCompletionBytes: number; maxCompletionEvents: number;
  maxDurationMs: number; retentionMs: number; pullWaitMs: number; closeWaitMs: number; idleLeaseMs: number;
}
export interface AIProviderLifecycleOptions {
  limits?: Partial<AIProviderLimits>; rootSignal?: AbortSignal;
}
/** Explicit declared-provider routing; no wildcard or global Generate fallback. */
export type AIProviderDispatcherOptions = AIProviderRegistryOptions;
/** Immutable, per-instance routing for commands shared by multiple declared contributions. */
export interface AIProviderRegistryOptions extends AIProviderLifecycleOptions {
  providers: Readonly<Record<string, AIProviderRegistration>>;
}
export const AI_PROVIDER_DEFAULT_LIMITS: Readonly<AIProviderLimits> = Object.freeze({
  maxWorkers: 16, maxSessions: 16, maxTombstones: 4096, maxRequestBytes: 512 * 1024,
  maxEventBytes: 64 * 1024, maxPullBytes: 128 * 1024, maxPullEvents: 16,
  maxQueueBytes: 512 * 1024, maxQueueEvents: 64, maxCompletionBytes: 8 * 1024 * 1024,
  maxCompletionEvents: 65536, maxDurationMs: 5 * 60 * 1000, retentionMs: 5 * 60 * 1000,
  pullWaitMs: 1000, closeWaitMs: 1000, idleLeaseMs: 30000,
});
