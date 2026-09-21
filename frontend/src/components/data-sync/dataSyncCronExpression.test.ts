import { describe, expect, it } from 'vitest';

import { inspectDataSyncCronExpression } from './dataSyncCronExpression';

/**
 * The grammar mirrors `parseCronSchedule` in internal/syncjob/validation.go, so
 * every accepted case below must stay schedulable and every rejected case must
 * be one the backend would fail with `cronExpression must contain five fields`
 * or a per-field `invalid cron ...` error.
 */
describe('data sync cron expression contract', () => {
  it('accepts the five-field expressions the scheduler supports', () => {
    const accepted = [
      '0 3 * * *',
      '*/5 * * * *',
      '0 0 1 * *',
      '30 9 * * 1-5',
      '0 0 1 1 *',
      '0,15,30,45 * * * *',
      '0 22 * * 0,6',
      '0 22 * * 7',
      '0 0 */2 * *',
      '  0 3 * * *  ',
      '0\t3\t*\t*\t*',
    ];

    for (const expression of accepted) {
      expect(
        inspectDataSyncCronExpression(expression),
        `expected "${expression}" to be accepted`,
      ).toBeNull();
    }
  });

  it('rejects the common six-field form with a field-count diagnosis', () => {
    // Issue #1298: `0 0 3 * * *` is the standard six-field (seconds) form and
    // is the exact expression users were told was merely "invalid definition".
    expect(inspectDataSyncCronExpression('0 0 3 * * *')).toBe(
      'cron_expression_field_count',
    );
    expect(inspectDataSyncCronExpression('*/5 * * * * *')).toBe(
      'cron_expression_field_count',
    );
    expect(inspectDataSyncCronExpression('0 3 * *')).toBe(
      'cron_expression_field_count',
    );
    expect(inspectDataSyncCronExpression('0 3 * * * * *')).toBe(
      'cron_expression_field_count',
    );
  });

  it('rejects out-of-range and malformed fields', () => {
    const rejected = [
      '60 3 * * *',
      '0 24 * * *',
      '0 3 0 * *',
      '0 3 32 * *',
      '0 3 * 13 *',
      '0 3 * * 8',
      '0 3 * * 1-8',
      '0 3 * * 5-1',
      'abc 3 * * *',
      '0 3 * * MON',
      '0 3 */0 * *',
      '0 3 */x * *',
      '0,,3 * * * *',
      '0 3 1-2-3 * *',
      '0 3 -5 * *',
    ];

    for (const expression of rejected) {
      expect(
        inspectDataSyncCronExpression(expression),
        `expected "${expression}" to be rejected`,
      ).toBe('cron_expression_invalid');
    }
  });
});
