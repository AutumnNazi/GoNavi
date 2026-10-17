import { describe, expect, it } from 'vitest';
import {
  buildFilterTime,
  formatXxlJobTime,
  isXxlJobLogRunning,
  LOG_STATUS_ALL,
  TRIGGER_STATUS_RUNNING,
} from './xxljobModel';

describe('xxljobModel', () => {
  it('把调度码归一到运行中判定', () => {
    expect(isXxlJobLogRunning({ triggerCode: 200, handleCode: 0 })).toBe(true);
    expect(isXxlJobLogRunning({ triggerCode: 500, handleCode: 0 })).toBe(false);
    expect(isXxlJobLogRunning({ triggerCode: 200, handleCode: 200 })).toBe(false);
    expect(isXxlJobLogRunning({ triggerCode: 200, handleCode: 500 })).toBe(false);
  });

  it('空时间统一显示为破折号', () => {
    expect(formatXxlJobTime(undefined)).toBe('—');
    expect(formatXxlJobTime('')).toBe('—');
    expect(formatXxlJobTime('   ')).toBe('—');
    expect(formatXxlJobTime('2026-10-17 10:00:00')).toBe('2026-10-17 10:00:00');
  });

  it('组装调度中心要求的 filterTime 形状', () => {
    expect(buildFilterTime(['2026-10-17 00:00:00', '2026-10-17 23:59:59']))
      .toBe('2026-10-17 00:00:00 - 2026-10-17 23:59:59');
    expect(buildFilterTime(null)).toBe('');
    expect(buildFilterTime(['2026-10-17 00:00:00', ''])).toBe('');
    expect(buildFilterTime(['  a  ', '  b  '])).toBe('a - b');
  });

  it('状态常量与调度中心一致', () => {
    expect(TRIGGER_STATUS_RUNNING).toBe(1);
    expect(LOG_STATUS_ALL).toBe(-1);
  });
});
