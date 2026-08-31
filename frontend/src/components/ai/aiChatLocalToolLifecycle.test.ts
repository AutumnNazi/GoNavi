import { afterEach, describe, expect, it } from 'vitest';

import {
  beginAIChatLocalToolRun,
  beginAIChatLocalToolTerminalStop,
  resetAIChatLocalToolStop,
  shouldStopAIChatLocalToolRun,
} from './aiChatLocalToolLifecycle';

const SESSION_ID = 'session-local-tool-lifecycle';

describe('aiChatLocalToolLifecycle', () => {
  afterEach(() => {
    resetAIChatLocalToolStop(SESSION_ID);
  });

  it('keeps a committed stop sticky when a concurrent stop attempt rolls back later', async () => {
    const firstAttempt = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    const secondAttempt = beginAIChatLocalToolTerminalStop([SESSION_ID]);

    firstAttempt.commit();
    secondAttempt.rollback();

    await expect(shouldStopAIChatLocalToolRun(SESSION_ID)).resolves.toBe(true);
  });

  it('releases an active tool run when the only terminal stop attempt rolls back', async () => {
    const finishRun = beginAIChatLocalToolRun(SESSION_ID);
    const stopAttempt = beginAIChatLocalToolTerminalStop([SESSION_ID]);
    const stopDecision = shouldStopAIChatLocalToolRun(SESSION_ID);

    stopAttempt.rollback();

    await expect(stopDecision).resolves.toBe(false);
    finishRun();
    await expect(stopAttempt.waitForIdle()).resolves.toBeUndefined();
  });

  it('invalidates an in-flight stop attempt when a new user turn resets the lifecycle', async () => {
    const stopAttempt = beginAIChatLocalToolTerminalStop([SESSION_ID]);

    resetAIChatLocalToolStop(SESSION_ID);
    stopAttempt.commit();

    await expect(shouldStopAIChatLocalToolRun(SESSION_ID)).resolves.toBe(false);
  });
});
