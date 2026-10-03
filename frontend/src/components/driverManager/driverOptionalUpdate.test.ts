import { describe, expect, it } from 'vitest';
import {
  isDriverReinstallTarget,
  isOptionalUpdateVisible,
  type DriverReinstallTargetState,
} from './driverOptionalUpdate';

const buildRow = (overrides: Partial<DriverReinstallTargetState>): DriverReinstallTargetState => ({
  builtIn: false,
  needsUpdate: false,
  optionalUpdate: false,
  expectedRevision: '',
  ...overrides,
});

describe('driverOptionalUpdate', () => {
  it('isOptionalUpdateVisible：仅 optionalUpdate 且 revision 未被 dismiss 时可见', () => {
    const row = buildRow({ optionalUpdate: true, expectedRevision: 'rev-1' });
    expect(isOptionalUpdateVisible(row, [])).toBe(true);
    expect(isOptionalUpdateVisible(row, ['rev-1'])).toBe(false);
    expect(isOptionalUpdateVisible(buildRow({ optionalUpdate: true, expectedRevision: '' }), [])).toBe(false);
    expect(isOptionalUpdateVisible(buildRow({ needsUpdate: true }), [])).toBe(false);
  });

  it('isDriverReinstallTarget：needsUpdate 恒为重装目标', () => {
    expect(isDriverReinstallTarget(buildRow({ needsUpdate: true }), [])).toBe(true);
    // needsUpdate 与 dismiss 无关（revision 即便曾被 dismiss，强制更新仍须重装）
    expect(isDriverReinstallTarget(buildRow({ needsUpdate: true, expectedRevision: 'rev-1' }), ['rev-1'])).toBe(true);
  });

  it('isDriverReinstallTarget：可见的可选更新纳入重装目标，dismiss 后退出', () => {
    const row = buildRow({ optionalUpdate: true, expectedRevision: 'rev-1' });
    expect(isDriverReinstallTarget(row, [])).toBe(true);
    expect(isDriverReinstallTarget(row, ['rev-1'])).toBe(false);
  });

  it('isDriverReinstallTarget：内置驱动与无更新驱动不算目标', () => {
    expect(isDriverReinstallTarget(buildRow({ builtIn: true, needsUpdate: true }), [])).toBe(false);
    expect(isDriverReinstallTarget(buildRow({ builtIn: true, optionalUpdate: true, expectedRevision: 'rev-1' }), [])).toBe(false);
    expect(isDriverReinstallTarget(buildRow({}), [])).toBe(false);
  });
});
