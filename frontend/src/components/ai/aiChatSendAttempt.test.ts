import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginAIChatLocalToolTerminalStop,
  resetAIChatLocalToolStop,
} from './aiChatLocalToolLifecycle';
import {
  createAIChatSendAttemptCoordinator,
  runAIChatSendAttemptStages,
} from './aiChatSendAttempt';

const SESSION_ID = 'session-send-preflight';

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

describe('aiChatSendAttempt', () => {
  afterEach(() => {
    resetAIChatLocalToolStop(SESSION_ID);
  });

  it('does not dispatch after a terminal stop commits during an async preflight', async () => {
    const coordinator = createAIChatSendAttemptCoordinator();
    const attempt = coordinator.begin(SESSION_ID);
    const preflight = createDeferred();
    const dispatch = vi.fn();
    const run = (async () => {
      try {
        await preflight.promise;
        if (await attempt.shouldAbort()) return;
        dispatch();
      } finally {
        attempt.finish();
      }
    })();

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    preflight.resolve();
    await Promise.all([run, terminalStop.waitForIdle()]);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('lets the preflight continue when terminal cancellation rolls back', async () => {
    const coordinator = createAIChatSendAttemptCoordinator();
    const attempt = coordinator.begin(SESSION_ID);
    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    const shouldAbort = attempt.shouldAbort();

    terminalStop.rollback();

    await expect(shouldAbort).resolves.toBe(false);
    attempt.finish();
    await expect(terminalStop.waitForIdle()).resolves.toBeUndefined();
  });

  it('keeps an invalidated old preflight dead after the session stop state is reset', async () => {
    const coordinator = createAIChatSendAttemptCoordinator();
    const attempt = coordinator.begin(SESSION_ID);

    coordinator.invalidate();
    resetAIChatLocalToolStop(SESSION_ID);

    await expect(attempt.shouldAbort()).resolves.toBe(true);
    attempt.finish();
  });

  it('does not dispatch when stop lands while system context is pending', async () => {
    const coordinator = createAIChatSendAttemptCoordinator();
    const attempt = coordinator.begin(SESSION_ID);
    const systemContext = createDeferred();
    const compressContext = vi.fn(async () => 'summary');
    const dispatch = vi.fn(async () => 'stream');

    const run = runAIChatSendAttemptStages({
      attempt,
      buildSystemContext: async () => {
        await systemContext.promise;
        return ['system'];
      },
      compressContext,
      dispatch,
    });

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    systemContext.resolve();

    await expect(run).resolves.toEqual({ aborted: true });
    expect(compressContext).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    attempt.finish();
    await expect(terminalStop.waitForIdle()).resolves.toBeUndefined();
  });

  it('does not dispatch when stop lands while context compression is pending', async () => {
    const coordinator = createAIChatSendAttemptCoordinator();
    const attempt = coordinator.begin(SESSION_ID);
    const compression = createDeferred();
    const dispatch = vi.fn(async () => 'stream');

    const run = runAIChatSendAttemptStages({
      attempt,
      buildSystemContext: async () => ['system'],
      compressContext: async () => {
        await compression.promise;
        return 'summary';
      },
      dispatch,
    });
    await Promise.resolve();

    const terminalStop = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    terminalStop.commit();
    compression.resolve();

    await expect(run).resolves.toEqual({ aborted: true });
    expect(dispatch).not.toHaveBeenCalled();
    attempt.finish();
    await expect(terminalStop.waitForIdle()).resolves.toBeUndefined();
  });
});
