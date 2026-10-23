import { describe, expect, it } from 'vitest';
import { decodeRuntime } from './decode';

describe('plugin runtime safe mode', () => {
  it('keeps safe mode and management permission as separate booleans', () => {
    expect(decodeRuntime({ safeMode: true, managementAllowed: true })).toEqual({ safeMode: true, managementAllowed: true });
    expect(decodeRuntime({ safeMode: false, managementAllowed: true }).safeMode).toBe(false);
  });
  it('carries the optional web runtime marker', () => {
    expect(decodeRuntime({ safeMode: false, managementAllowed: false, webRuntime: true }))
      .toEqual({ safeMode: false, managementAllowed: false, webRuntime: true });
    expect(decodeRuntime({ safeMode: false, managementAllowed: true }).webRuntime).toBeUndefined();
  });
  it.each([{}, { safeMode: 'true', managementAllowed: true }, { safeMode: true },
    { safeMode: false, managementAllowed: true, webRuntime: 'yes' }])('rejects malformed runtime info %j', (value) => {
    expect(() => decodeRuntime(value)).toThrow();
  });
});
