import { describe, expect, it } from 'vitest';
import { classifyGalleryRuntime } from './runtime';

describe('gallery runtime authority', () => {
  it('uses explicit Web even when desktop-like bindings or detached bridge objects exist', () => {
    expect(classifyGalleryRuntime({ buildType: 'web', platform: 'linux' }, { __GONAVI_DETACHED__: { active: true } })).toBe('web');
    expect(classifyGalleryRuntime({ buildType: 'production', platform: 'darwin' }, { __GONAVI_WEB_RUNTIME__: { buildType: 'web' } })).toBe('web');
  });
  it.each(['dev', 'production'])('recognizes Wails %s only with native platform', (buildType) => {
    expect(classifyGalleryRuntime({ buildType, platform: 'darwin' })).toBe('desktop');
    expect(classifyGalleryRuntime({ buildType, platform: 'browser' })).toBe('unsupported');
  });
  it('recognizes explicit desktop detached and never guesses from URL or bridge existence', () => {
    expect(classifyGalleryRuntime({ buildType: 'desktop-detached' })).toBe('desktop');
    expect(classifyGalleryRuntime(null, { __GONAVI_NATIVE_DETACHED__: true })).toBe('desktop');
    expect(classifyGalleryRuntime(null, { __GONAVI_DETACHED_RUNTIME__: { buildType: 'desktop-detached', capabilities: { nativeWindow: true, sharedBackend: true } } })).toBe('desktop');
    expect(classifyGalleryRuntime(null, { __GONAVI_DETACHED__: {} })).toBe('unsupported');
    expect(classifyGalleryRuntime(null)).toBe('unsupported');
    expect(classifyGalleryRuntime({ buildType: 'mock', platform: 'darwin' })).toBe('unsupported');
  });
});
