import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOW_SPEC_CORES,
  LOW_SPEC_MEMORY_MB,
  detectRuntimeCapability,
  detectRuntimeCapabilityCached,
  probeWebGL,
  readCpuCores,
  readDeviceMemoryMb,
  resetRuntimeCapabilityCache,
  resolveLowSpecModeActive,
  shouldReduceMotion,
} from './runtimeCapability';

describe('runtime capability detection', () => {
  afterEach(() => {
    resetRuntimeCapabilityCache();
    // stubGlobal 不受 restoreAllMocks 管辖，必须单独还原，否则 document 桩会漏给后续用例。
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('flags a 4-core machine with weak memory as low spec', () => {
    const info = detectRuntimeCapability({ cpuCores: 4, deviceMemoryMb: 4096, hasWebGL: true });

    expect(info.lowSpec).toBe(true);
    expect(info.reasons).toContain(`cpu<=${LOW_SPEC_CORES}cores`);
    expect(info.reasons).toContain(`mem<=${LOW_SPEC_MEMORY_MB / 1024}GB`);
  });

  it('flags an 8-core machine without WebGL as low spec', () => {
    const info = detectRuntimeCapability({ cpuCores: 8, deviceMemoryMb: 16384, hasWebGL: false });

    expect(info.lowSpec).toBe(true);
    expect(info.reasons).toEqual(['no-webgl']);
  });

  it('keeps a high-end machine out of the low spec tier', () => {
    const info = detectRuntimeCapability({ cpuCores: 16, deviceMemoryMb: 32768, hasWebGL: true });

    expect(info.lowSpec).toBe(false);
    expect(info.reasons).toEqual([]);
  });

  it('does not downgrade on unknown device memory alone', () => {
    // deviceMemory 是 Chrome 非标准 API，缺失时归 0（未知）；此时仅凭内存不能判定低配。
    const unknownMemory16Core = detectRuntimeCapability({
      cpuCores: 16,
      deviceMemoryMb: 0,
      hasWebGL: true,
    });
    expect(unknownMemory16Core.lowSpec).toBe(false);
    expect(unknownMemory16Core.reasons).toEqual([]);

    // 但弱 CPU + 未知内存仍应命中：4 核机不知道内存，宁可按低配处理。
    const weakCpuUnknownMemory = detectRuntimeCapability({
      cpuCores: 4,
      deviceMemoryMb: 0,
      hasWebGL: true,
    });
    expect(weakCpuUnknownMemory.lowSpec).toBe(true);
    expect(weakCpuUnknownMemory.reasons).toEqual([`cpu<=${LOW_SPEC_CORES}cores`]);
  });

  it('treats unknown cpu cores as unknown rather than weak', () => {
    const info = detectRuntimeCapability({ cpuCores: 0, deviceMemoryMb: 0, hasWebGL: true });

    expect(info.lowSpec).toBe(false);
    expect(info.reasons).toEqual([]);
  });

  it('does not flag a strong machine with a small but sufficient memory reading', () => {
    // 边界：8 核 + 8GB 属于可用档位，只有内存小或 CPU 弱才降级。
    const info = detectRuntimeCapability({ cpuCores: 8, deviceMemoryMb: 8192, hasWebGL: true });

    expect(info.lowSpec).toBe(false);
  });

  it('reads cpu cores and device memory from navigator without throwing', () => {
    vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue({
      hardwareConcurrency: 6,
      deviceMemory: 8,
    } as unknown as Navigator);

    expect(readCpuCores()).toBe(6);
    expect(readDeviceMemoryMb()).toBe(8192);
  });

  it('returns 0 for missing or invalid navigator capability fields', () => {
    vi.spyOn(globalThis, 'navigator', 'get').mockReturnValue({
      hardwareConcurrency: Number.NaN,
      deviceMemory: -1,
    } as unknown as Navigator);

    expect(readCpuCores()).toBe(0);
    expect(readDeviceMemoryMb()).toBe(0);
  });

  it('treats a non-browser environment as WebGL capable', () => {
    // 显式把 document 置空，用例不依赖 vitest 当前是否 jsdom：
    // node/SSR 下没有 canvas 可探，此时不能把环境直接判成「无显卡低配」。
    vi.stubGlobal('document', undefined);

    expect(probeWebGL()).toBe(true);
  });

  it('reports no WebGL when getContext throws', () => {
    const canvas = {
      getContext: () => {
        throw new Error('driver exploded');
      },
    };
    // document 桩由 afterEach 的 unstubAllGlobals 统一还原。
    vi.stubGlobal('document', { createElement: () => canvas });

    expect(probeWebGL()).toBe(false);
  });

  it('caches the probe until the cache is reset', () => {
    const first = detectRuntimeCapabilityCached();
    const second = detectRuntimeCapabilityCached();
    expect(second).toBe(first);

    resetRuntimeCapabilityCache();
    const third = detectRuntimeCapabilityCached();
    expect(third).not.toBe(first);
  });

  it('resolves the three-state low spec preference', () => {
    // null = 跟随自动检测；显式 true / false 覆盖检测结果。
    expect(resolveLowSpecModeActive(null, true)).toBe(true);
    expect(resolveLowSpecModeActive(null, false)).toBe(false);
    expect(resolveLowSpecModeActive(undefined, true)).toBe(true);
    expect(resolveLowSpecModeActive(true, false)).toBe(true);
    expect(resolveLowSpecModeActive(false, true)).toBe(false);
  });

  it('reduces motion when the user opts in or the machine is low spec', () => {
    expect(shouldReduceMotion(true, false)).toBe(true);
    expect(shouldReduceMotion(true, true)).toBe(true);
    expect(shouldReduceMotion(false, true)).toBe(true);
    expect(shouldReduceMotion(false, false)).toBe(false);
    expect(shouldReduceMotion(null, false)).toBe(false);
  });
});
