import type { AIToolCall } from '../../types';
import { decodeRawJSONWithStatus } from './aiRawMessage';

export const AI_RUN_EVENT_NAME = 'ai:run:event';
export const AI_RUN_EVENT_SCHEMA_VERSION = 1;

export type AIRunState =
  | 'queued'
  | 'running_model'
  | 'awaiting_approval'
  | 'running_tool'
  | 'awaiting_workspace'
  | 'interrupted'
  | 'recovery_required'
  | 'canceling'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'exhausted';

export type AIRunEventKind =
  | 'input'
  | 'model_delta'
  | 'model_completed'
  | 'tool'
  | 'approval'
  | 'usage'
  | 'checkpoint'
  | 'run_error'
  | 'terminal';

export interface AIRunInputPayload {
  requestId?: string;
  contentHash?: string;
  dispatchMode?: 'queue' | 'steer';
}

export interface AIRunModelDeltaPayload {
  text?: string;
  reasoning?: string;
  callId?: string;
  toolCalls?: AIRunToolIntent[];
}

export interface AIRunToolIntent {
  callId: string;
  toolName: string;
  arguments?: unknown;
  effect?: string;
  argsHash?: string;
}

export interface AIRunModelCompletedPayload {
  text?: string;
  reasoning?: string;
  toolCalls?: AIRunToolIntent[];
  usage?: AIRunUsage;
}

export interface AIRunToolPayload {
  callId?: string;
  toolName?: string;
  effect?: string;
  status?: string;
  argsHash?: string;
  resultHash?: string;
  errorCode?: string;
  truncated?: boolean;
}

export interface AIRunApprovalPayload {
  approvalId?: string;
  callId?: string;
  decision?: string;
}

/**
 * UI-safe approval projection. Arguments are only available when the model
 * emitted the corresponding typed tool intent; the durable approval record
 * remains encrypted and is never fetched by the desktop projection.
 */
export interface AIRunApprovalState {
  runId: string;
  sessionId: string;
  approvalId: string;
  callId: string;
  decision: string;
  toolName?: string;
  effect?: string;
  arguments?: unknown;
  argsHash?: string;
  revision: number;
}

/** A side-effect outcome that needs an explicit user recovery decision. */
export interface AIRunRecoveryState {
  runId: string;
  sessionId: string;
  callId?: string;
  toolName?: string;
  effect?: string;
  status?: string;
  errorCode?: string;
  reason?: string;
  revision: number;
}

/** A run paused until its bound desktop or CLI workspace source is available. */
export interface AIRunWorkspaceState {
  runId: string;
  sessionId: string;
  revision: number;
}

export interface AIRunUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AIRunUsagePayload {
  usage?: AIRunUsage;
}

export interface AIRunCheckpointPayload {
  checkpointId?: string;
  sequence?: number;
}

export interface AIRunErrorPayload {
  code?: string;
  message?: string;
  retryable?: boolean;
}

export interface AIRunTerminalPayload {
  reason?: string;
  errorCode?: string;
}

export type AIRunEventPayload =
  | AIRunInputPayload
  | AIRunModelDeltaPayload
  | AIRunModelCompletedPayload
  | AIRunToolPayload
  | AIRunApprovalPayload
  | AIRunUsagePayload
  | AIRunCheckpointPayload
  | AIRunErrorPayload
  | AIRunTerminalPayload
  | Record<string, unknown>;

export interface AIRunEvent<TPayload extends AIRunEventPayload = AIRunEventPayload> {
  schemaVersion: number;
  runId: string;
  sessionId: string;
  sessionGeneration: number;
  sequence: number;
  runRevision: number;
  attempt: number;
  timestamp: string | number;
  kind: AIRunEventKind;
  resultingState: AIRunState;
  payload: TPayload;
}

const RUN_STATES = new Set<AIRunState>([
  'queued',
  'running_model',
  'awaiting_approval',
  'running_tool',
  'awaiting_workspace',
  'interrupted',
  'recovery_required',
  'canceling',
  'completed',
  'failed',
  'canceled',
  'exhausted',
]);

const EVENT_KINDS = new Set<AIRunEventKind>([
  'input',
  'model_delta',
  'model_completed',
  'tool',
  'approval',
  'usage',
  'checkpoint',
  'run_error',
  'terminal',
]);

export const isAIRunTerminalState = (state: AIRunState): boolean =>
  state === 'completed'
  || state === 'failed'
  || state === 'canceled'
  || state === 'exhausted';

const toNonNegativeInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const parsePayload = (value: unknown): Record<string, unknown> | null => {
  if (value === undefined || value === null || value === '') return {};
  const decoded = decodeRawJSONWithStatus(value);
  if (!decoded.valid) return null;
  const parsed = decoded.value;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
};

export const parseAIRunEvent = (value: unknown): AIRunEvent | null => {
  const decoded = decodeRawJSONWithStatus(value);
  if (!decoded.valid) return null;
  if (!decoded.value || typeof decoded.value !== 'object' || Array.isArray(decoded.value)) return null;
  const raw = decoded.value as Record<string, unknown>;
  const schemaVersion = toNonNegativeInteger(raw.schemaVersion);
  const sessionGeneration = toNonNegativeInteger(raw.sessionGeneration);
  const sequence = toNonNegativeInteger(raw.sequence);
  const runRevision = toNonNegativeInteger(raw.runRevision);
  const attempt = toNonNegativeInteger(raw.attempt);
  const runId = String(raw.runId || '').trim();
  const sessionId = String(raw.sessionId || '').trim();
  const kind = String(raw.kind || '') as AIRunEventKind;
  const resultingState = String(raw.resultingState || '') as AIRunState;
  const payload = parsePayload(raw.payload);

  if (
    schemaVersion !== AI_RUN_EVENT_SCHEMA_VERSION
    || !runId
    || !sessionId
    || sessionGeneration === null
    || sequence === null
    || sequence < 1
    || runRevision === null
    || attempt === null
    || !EVENT_KINDS.has(kind)
    || !RUN_STATES.has(resultingState)
    || payload === null
  ) {
    return null;
  }

  const timestamp = typeof raw.timestamp === 'number'
    ? raw.timestamp
    : String(raw.timestamp || '');

  return {
    schemaVersion,
    runId,
    sessionId,
    sessionGeneration,
    sequence,
    runRevision,
    attempt,
    timestamp,
    kind,
    resultingState,
    payload,
  };
};

export type AIRunSequenceDecision =
  | { disposition: 'accepted'; event: AIRunEvent }
  | { disposition: 'duplicate' | 'late_terminal'; event: AIRunEvent }
  | { disposition: 'gap'; event: AIRunEvent; afterSequence: number };

interface AIRunSequenceState {
  lastSequence: number;
  terminal: boolean;
}

/**
 * Enforces the durable event ordering contract before UI state is mutated.
 * Gaps are deliberately not advanced; callers must replay from afterSequence.
 */
export class AIRunEventSequenceTracker {
  private readonly runs = new Map<string, AIRunSequenceState>();

  observe(event: AIRunEvent): AIRunSequenceDecision {
    const current = this.runs.get(event.runId) || { lastSequence: 0, terminal: false };
    if (current.terminal) {
      return { disposition: 'late_terminal', event };
    }
    if (event.sequence <= current.lastSequence) {
      return { disposition: 'duplicate', event };
    }
    if (event.sequence !== current.lastSequence + 1) {
      return {
        disposition: 'gap',
        event,
        afterSequence: current.lastSequence,
      };
    }

    const terminal = event.kind === 'terminal' || isAIRunTerminalState(event.resultingState);
    this.runs.set(event.runId, { lastSequence: event.sequence, terminal });
    return { disposition: 'accepted', event };
  }

  lastSequence(runId: string): number {
    return this.runs.get(runId)?.lastSequence || 0;
  }

  reset(runId?: string): void {
    if (runId) {
      this.runs.delete(runId);
      return;
    }
    this.runs.clear();
  }
}

// Keep the event cursor shared when the docked and detached presentations are
// mounted at the same time. Both views can subscribe to Wails events, but a
// durable event must only be projected into the store once.
export const sharedAIRunEventSequenceTracker = new AIRunEventSequenceTracker();

const isToolIntentRecord = (value: unknown): value is AIRunToolIntent => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value),
);

/**
 * Tool arguments are part of the trusted UI projection. Keep only structured
 * JSON values; a partial JSON/XML fragment must never become a visible or
 * executable-looking tool call. IDs are unique within one model turn.
 */
export const normalizeAIRunToolIntent = (value: unknown): AIRunToolIntent | null => {
  if (!isToolIntentRecord(value)) return null;
  const id = String(value.callId || '').trim();
  const name = String(value.toolName || '').trim();
  if (!id || !name) return null;

  if (value.arguments === undefined) return value;
  const decoded = decodeRawJSONWithStatus(value.arguments);
  if (!decoded.valid) return null;
  if (decoded.value === null || typeof decoded.value !== 'object') return null;
  if (decoded.value === value.arguments) return value;
  // Keep approval cards and message projections on the decoded structured
  // value, rather than retaining a byte-shaped pseudo-object.
  return { ...value, arguments: decoded.value };
};

export const toAIRunToolCalls = (payload: AIRunModelCompletedPayload): AIToolCall[] => {
  if (!Array.isArray(payload.toolCalls)) return [];
  const seen = new Set<string>();
  return payload.toolCalls.flatMap((intent) => {
    const normalized = normalizeAIRunToolIntent(intent);
    if (!normalized) return [];
    const id = String(normalized.callId).trim();
    const name = String(normalized.toolName).trim();
    if (seen.has(id)) return [];
    seen.add(id);
    let args = '{}';
    if (typeof normalized.arguments === 'string') {
      args = normalized.arguments;
    } else if (normalized.arguments !== undefined) {
      try {
        args = JSON.stringify(normalized.arguments);
      } catch {
        return [];
      }
    }
    return [{
      id,
      type: 'function',
      function: { name, arguments: args },
    }];
  });
};

export const toAIRunEventTimestamp = (value: string | number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Date.now();
};
