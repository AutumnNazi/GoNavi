import { describe, expect, it } from 'vitest';
import { formatMockDataTemporal, parseMockDataTemporal } from './MockDataTemporalInputs';

describe('mock data temporal inputs', () => {
  it('round-trips the backend text formats', () => {
    expect(formatMockDataTemporal(parseMockDataTemporal('2026-01-02 03:04:05', 'datetime'), 'datetime')).toBe('2026-01-02 03:04:05');
    expect(formatMockDataTemporal(parseMockDataTemporal('2026-01-02', 'date'), 'date')).toBe('2026-01-02');
    expect(formatMockDataTemporal(parseMockDataTemporal('08:30:00', 'time'), 'time')).toBe('08:30:00');
  });

  it('treats empty or malformed text as no value instead of guessing', () => {
    expect(parseMockDataTemporal('', 'date')).toBeNull();
    expect(parseMockDataTemporal('2026/01/02', 'date')).toBeNull();
    expect(formatMockDataTemporal(null, 'datetime')).toBe('');
  });
});
