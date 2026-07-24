import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateMacOSDockCornerRadius,
  calculateMacOSDockImageRect,
  composeMacOSDockIconBase64,
  shouldSyncMacOSDockIcon,
} from './macDockIcon';

describe('shouldSyncMacOSDockIcon', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only allows the native macOS runtime', () => {
    expect(shouldSyncMacOSDockIcon({ platform: 'darwin', buildType: 'production' })).toBe(true);
    expect(shouldSyncMacOSDockIcon({ platform: 'DARWIN', buildType: 'debug' })).toBe(true);
  });

  it('skips browser and non-macOS runtimes before image composition', () => {
    expect(shouldSyncMacOSDockIcon({ platform: 'darwin', buildType: 'web' })).toBe(false);
    expect(shouldSyncMacOSDockIcon({ platform: 'windows', buildType: 'production' })).toBe(false);
    expect(shouldSyncMacOSDockIcon({ platform: 'linux', buildType: 'production' })).toBe(false);
    expect(shouldSyncMacOSDockIcon()).toBe(false);
  });

  it('fits square brand icons into the standard macOS Dock safe area', () => {
    const rect = calculateMacOSDockImageRect(512, 512);

    expect(rect).toEqual({
      x: 100,
      y: 100,
      width: 824,
      height: 824,
    });
    expect(calculateMacOSDockCornerRadius(rect)).toBe(184);
  });

  it('centres portrait brand lockups without stretching them into a square', () => {
    expect(calculateMacOSDockImageRect(272, 449)).toEqual({
      x: 263,
      y: 100,
      width: 499,
      height: 824,
    });
  });

  it('clips the complete brand image to the standard macOS rounded tile before drawing', async () => {
    const calls: string[] = [];
    const arcTo = vi.fn((...args: number[]) => calls.push(`arcTo:${args[4]}`));
    const context = {
      beginPath: vi.fn(() => calls.push('beginPath')),
      moveTo: vi.fn(() => calls.push('moveTo')),
      lineTo: vi.fn(() => calls.push('lineTo')),
      arcTo,
      closePath: vi.fn(() => calls.push('closePath')),
      clip: vi.fn(() => calls.push('clip')),
      drawImage: vi.fn(() => calls.push('drawImage')),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,encoded'),
    } as unknown as HTMLCanvasElement;

    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 512;
      naturalHeight = 512;
      width = 512;
      height = 512;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    await expect(composeMacOSDockIconBase64('/brand-icons/09-terminal-sit.webp')).resolves.toBe('encoded');
    expect(arcTo.mock.calls.map((args) => args[4])).toEqual([184, 184, 184, 184]);
    expect(calls.indexOf('clip')).toBeGreaterThan(calls.indexOf('beginPath'));
    expect(calls.indexOf('drawImage')).toBeGreaterThan(calls.indexOf('clip'));
  });
});
