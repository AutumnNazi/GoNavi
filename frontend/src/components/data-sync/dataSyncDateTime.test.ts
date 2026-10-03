import { describe, expect, it } from 'vitest';
import { fromLocalDateTimeInput, toLocalDateTimeInput } from './dataSyncDateTime';

describe('scheduled local date input', () => {
  it('rejects invalid dates', () => {
    expect(toLocalDateTimeInput('invalid')).toBe('');
    expect(fromLocalDateTimeInput('')).toBe('');
  });
  it('round trips the local time without changing the instant', () => {
    const instant = '2026-09-22T02:30:00.000Z';
    expect(fromLocalDateTimeInput(toLocalDateTimeInput(instant))).toBe(instant);
  });
});
