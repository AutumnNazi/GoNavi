import { afterEach, describe, expect, it } from 'vitest';

import { isSqlAiCompletionEnabled, setSqlAiCompletionEnabled } from './sqlAiCompletionEnabled';

describe('sqlAiCompletionEnabled', () => {
  afterEach(() => {
    setSqlAiCompletionEnabled(true);
  });

  it('stays enabled until the user turns it off', () => {
    expect(isSqlAiCompletionEnabled()).toBe(true);
    setSqlAiCompletionEnabled(false);
    expect(isSqlAiCompletionEnabled()).toBe(false);
    setSqlAiCompletionEnabled(true);
    expect(isSqlAiCompletionEnabled()).toBe(true);
  });
});
