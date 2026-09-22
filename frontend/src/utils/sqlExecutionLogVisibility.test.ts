import { describe, expect, it, vi } from 'vitest';

import {
  getSqlExecutionLogOpen,
  publishSqlExecutionLogOpen,
  resetSqlExecutionLogOpenForTests,
  subscribeSqlExecutionLogOpen,
} from './sqlExecutionLogVisibility';

describe('sqlExecutionLogVisibility', () => {
  it('publishes changes and ignores repeats', () => {
    resetSqlExecutionLogOpenForTests();
    const listener = vi.fn();
    const unsubscribe = subscribeSqlExecutionLogOpen(listener);

    publishSqlExecutionLogOpen(true);
    publishSqlExecutionLogOpen(true);

    expect(getSqlExecutionLogOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    resetSqlExecutionLogOpenForTests();
    const listener = vi.fn();
    const unsubscribe = subscribeSqlExecutionLogOpen(listener);
    unsubscribe();

    publishSqlExecutionLogOpen(true);

    expect(listener).not.toHaveBeenCalled();
  });
});
