type LocalToolStopStatus = 'running' | 'stopped';

interface LocalToolPendingStopDecision {
  promise: Promise<void>;
  resolve: () => void;
}

interface LocalToolLifecycleState {
  status: LocalToolStopStatus;
  activeRuns: number;
  pendingStopDecisions: Map<symbol, LocalToolPendingStopDecision>;
  idleWaiters: Set<() => void>;
}

const lifecycleBySession = new Map<string, LocalToolLifecycleState>();

const normalizeSessionId = (sid: string): string => String(sid || '').trim();

const getLifecycleState = (sid: string): LocalToolLifecycleState => {
  const sessionId = normalizeSessionId(sid);
  let state = lifecycleBySession.get(sessionId);
  if (!state) {
    state = {
      status: 'running',
      activeRuns: 0,
      pendingStopDecisions: new Map(),
      idleWaiters: new Set(),
    };
    lifecycleBySession.set(sessionId, state);
  }
  return state;
};

const resolvePendingStopDecision = (
  state: LocalToolLifecycleState,
  attemptId: symbol,
): boolean => {
  const decision = state.pendingStopDecisions.get(attemptId);
  if (!decision) return false;
  state.pendingStopDecisions.delete(attemptId);
  decision.resolve();
  return true;
};

export const resetAIChatLocalToolStop = (sid: string): void => {
  const sessionId = normalizeSessionId(sid);
  if (!sessionId) return;
  const state = lifecycleBySession.get(sessionId);
  if (!state) return;

  for (const decision of state.pendingStopDecisions.values()) {
    decision.resolve();
  }
  state.pendingStopDecisions.clear();
  state.status = 'running';
  if (state.activeRuns === 0) lifecycleBySession.delete(sessionId);
};

export const beginAIChatLocalToolRun = (sid: string): (() => void) => {
  const sessionId = normalizeSessionId(sid);
  if (!sessionId) return () => undefined;
  const state = getLifecycleState(sessionId);
  state.activeRuns += 1;
  let finished = false;

  return () => {
    if (finished) return;
    finished = true;
    state.activeRuns = Math.max(0, state.activeRuns - 1);
    if (state.activeRuns === 0) {
      for (const resolve of state.idleWaiters) resolve();
      state.idleWaiters.clear();
      if (state.status === 'running' && state.pendingStopDecisions.size === 0) {
        lifecycleBySession.delete(sessionId);
      }
    }
  };
};

export const shouldStopAIChatLocalToolRun = async (sid: string): Promise<boolean> => {
  const sessionId = normalizeSessionId(sid);
  if (!sessionId) return false;
  const state = lifecycleBySession.get(sessionId);
  if (!state) return false;
  while (state.status !== 'stopped' && state.pendingStopDecisions.size > 0) {
    await Promise.race(
      [...state.pendingStopDecisions.values()].map((decision) => decision.promise),
    );
  }
  return state.status === 'stopped';
};

const waitForSessionIdle = (sid: string): Promise<void> => {
  const state = lifecycleBySession.get(sid);
  if (!state || state.activeRuns === 0) return Promise.resolve();
  return new Promise<void>((resolve) => state.idleWaiters.add(resolve));
};

export interface AIChatLocalToolTerminalStopAttempt {
  commit: () => void;
  rollback: () => void;
  waitForIdle: () => Promise<void>;
}

export const beginAIChatLocalToolTerminalStop = (
  sessionIds: string[],
): AIChatLocalToolTerminalStopAttempt => {
  const ids = [...new Set(sessionIds.map(normalizeSessionId).filter(Boolean))];
  const attemptId = Symbol('ai-chat-local-tool-terminal-stop');

  for (const sessionId of ids) {
    const state = getLifecycleState(sessionId);
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });
    state.pendingStopDecisions.set(attemptId, { promise, resolve });
  }

  let decided = false;
  const decide = (stopped: boolean) => {
    if (decided) return;
    decided = true;
    for (const sessionId of ids) {
      const state = lifecycleBySession.get(sessionId);
      if (!state || !state.pendingStopDecisions.has(attemptId)) continue;
      if (stopped) state.status = 'stopped';
      resolvePendingStopDecision(state, attemptId);
      if (
        state.status === 'running'
        && state.activeRuns === 0
        && state.pendingStopDecisions.size === 0
      ) {
        lifecycleBySession.delete(sessionId);
      }
    }
  };

  return {
    commit: () => decide(true),
    rollback: () => decide(false),
    waitForIdle: () => Promise.all(ids.map(waitForSessionIdle)).then(() => undefined),
  };
};
