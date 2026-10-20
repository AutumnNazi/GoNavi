import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculateFittedMarkDrawRect,
  calculateMacOSDockCornerRadius,
  calculateMacOSDockImageRect,
  calculateWindowsNativeIconSourceCrop,
  composeMacOSDockIconBase64,
  composeWindowsNativeIconBase64,
  keepLargestOpaqueComponent,
  removeConnectedNearWhiteBackground,
  shouldSyncApplicationBrandIcon,
  type MarkBoundingBox,
} from './macDockIcon';

describe('shouldSyncApplicationBrandIcon', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows native macOS and Windows runtimes', () => {
    expect(shouldSyncApplicationBrandIcon({ platform: 'darwin', buildType: 'production' })).toBe(true);
    expect(shouldSyncApplicationBrandIcon({ platform: 'DARWIN', buildType: 'debug' })).toBe(true);
    expect(shouldSyncApplicationBrandIcon({ platform: 'windows', buildType: 'production' })).toBe(true);
    expect(shouldSyncApplicationBrandIcon({ platform: 'WINDOWS', buildType: 'debug' })).toBe(true);
  });

  it('skips browser and unsupported desktop runtimes before image composition', () => {
    expect(shouldSyncApplicationBrandIcon({ platform: 'darwin', buildType: 'web' })).toBe(false);
    expect(shouldSyncApplicationBrandIcon({ platform: 'windows', buildType: 'web' })).toBe(false);
    expect(shouldSyncApplicationBrandIcon({ platform: 'linux', buildType: 'production' })).toBe(false);
    expect(shouldSyncApplicationBrandIcon()).toBe(false);
  });

  it('fills the whole canvas when no grid inset is requested (Windows full-bleed tile)', () => {
    const rect = calculateMacOSDockImageRect(512, 512);

    expect(rect).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 1024,
    });
    expect(calculateMacOSDockCornerRadius(rect)).toBe(229);
  });

  it('keeps the mascot inside the Apple 824px grid content area', () => {
    expect(calculateMacOSDockImageRect(512, 512, 100)).toEqual({
      x: 100,
      y: 100,
      width: 824,
      height: 824,
    });
  });

  it('centres portrait brand lockups without stretching them into a square', () => {
    expect(calculateMacOSDockImageRect(272, 449)).toEqual({
      x: 202,
      y: 0,
      width: 620,
      height: 1024,
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

    await expect(composeMacOSDockIconBase64('/brand-icons/03-ribbon-graphite-glow.webp')).resolves.toBe('encoded');
    expect(arcTo.mock.calls.map((args) => args[4])).toEqual([229, 229, 229, 229]);
    expect(calls.indexOf('clip')).toBeGreaterThan(calls.indexOf('beginPath'));
    expect(calls.indexOf('drawImage')).toBeGreaterThan(calls.indexOf('clip'));
  });

  it('composes ribbon artwork onto the strict Apple grid with the zoom crop', async () => {
    const drawImage = vi.fn();
    const arcTo = vi.fn();
    const context = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo,
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage,
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

    await expect(composeMacOSDockIconBase64('/brand-icons/02-ribbon-graphite.svg', {
      inset: 100,
      zoom: 1.25,
    })).resolves.toBe('encoded');
    // Apple grid: 824px content area with the standard 184px corner radius.
    expect(arcTo.mock.calls.map((args) => args[4])).toEqual([184, 184, 184, 184]);
    // Ribbon zoom centre-crops the 20% breathing margin before the grid fit.
    expect(drawImage.mock.calls[0]).toEqual([
      expect.anything(),
      51,
      51,
      410,
      410,
      100,
      100,
      824,
      824,
    ]);
  });

  it('paints the white tile base before clipping when fillTileBackground is set', async () => {
    const drawCalls: string[] = [];
    const fill = vi.fn(() => drawCalls.push('fill'));
    const clip = vi.fn(() => drawCalls.push('clip'));
    const context = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fill,
      fillStyle: '',
      clip,
      drawImage: vi.fn(() => drawCalls.push('drawImage')),
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

    await expect(composeMacOSDockIconBase64('/brand-icons/07-database-hug.webp', {
      inset: 100,
      fillTileBackground: true,
    })).resolves.toBe('encoded');
    expect(context.fillStyle).toBe('#ffffff');
    // The white Apple silhouette must land before the clipped artwork.
    expect(drawCalls).toEqual(['fill', 'clip', 'drawImage']);
  });
});

describe('calculateWindowsNativeIconSourceCrop', () => {
  it('keeps the full source when no zoom is requested', () => {
    expect(calculateWindowsNativeIconSourceCrop(512)).toEqual({ offset: 0, size: 512 });
    expect(calculateWindowsNativeIconSourceCrop(512, 1)).toEqual({ offset: 0, size: 512 });
  });

  it('crops the 1.13 mascot zoom symmetrically without touching the artwork', () => {
    expect(calculateWindowsNativeIconSourceCrop(512, 1.13)).toEqual({ offset: 29, size: 454 });
  });

  it('degrades degenerate sources and clamps runaway zoom values', () => {
    expect(calculateWindowsNativeIconSourceCrop(0, 1.13)).toEqual({ offset: 0, size: 1 });
    expect(calculateWindowsNativeIconSourceCrop(512, Number.NaN)).toEqual({ offset: 0, size: 512 });
    expect(calculateWindowsNativeIconSourceCrop(512, 9)).toEqual({ offset: 128, size: 256 });
  });
});

describe('composeWindowsNativeIconBase64', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCanvasContext() {
    const drawImage = vi.fn();
    const arcTo = vi.fn();
    const context = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo,
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,encoded'),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    return { drawImage, arcTo };
  }

  function stubSquareImage(): void {
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
  }

  it('fills the whole Windows tile without the macOS Dock safe-area inset', async () => {
    stubSquareImage();
    const { drawImage, arcTo } = stubCanvasContext();

    await expect(composeWindowsNativeIconBase64('/brand-icons/03-ribbon-graphite-glow.svg')).resolves.toBe('encoded');
    expect(drawImage.mock.calls[0]).toEqual([
      expect.anything(),
      0,
      0,
      1024,
      1024,
    ]);
    expect(arcTo.mock.calls.map((args) => args[4])).toEqual([229, 229, 229, 229]);
  });

  it('centre-crops the mascot zoom across the full rounded tile', async () => {
    stubSquareImage();
    const { drawImage } = stubCanvasContext();

    await expect(composeWindowsNativeIconBase64('/brand-icons/07-database-hug.webp', { zoom: 1.13 }))
      .resolves.toBe('encoded');
    expect(drawImage.mock.calls[0]).toEqual([
      expect.anything(),
      29,
      29,
      454,
      454,
      0,
      0,
      1024,
      1024,
    ]);
  });

  it('cut-out marks keep only the mascot at the fitted size with no background', async () => {
    // 8x8 source: white tile, one red 2x2 mark, one detached green speck.
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 255;
    }
    for (let y = 2; y < 4; y++) {
      for (let x = 2; x < 4; x++) {
        const i = (y * 8 + x) * 4;
        data[i] = 200; data[i + 1] = 40; data[i + 2] = 40;
      }
    }
    data[(6 * 8 + 6) * 4] = 40;
    data[(6 * 8 + 6) * 4 + 1] = 160;
    data[(6 * 8 + 6) * 4 + 2] = 60;

    const backgroundBox = removeConnectedNearWhiteBackground(data, 8, 8);
    expect(backgroundBox).toEqual({ x: 2, y: 2, width: 5, height: 5 });
    const markBox = keepLargestOpaqueComponent(data, 8, 8);
    expect(markBox).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(data[(6 * 8 + 6) * 4 + 3]).toBe(0);
    expect(data[(2 * 8 + 2) * 4 + 3]).toBe(255);

    expect(calculateFittedMarkDrawRect(markBox as MarkBoundingBox, 1024)).toEqual({
      x: 16,
      y: 16,
      width: 993,
      height: 993,
    });
  });

  it('composes transparent marks with a soft shadow silhouette and no tile', async () => {
    // 8x8 white image with a red 2x2 mark; the fake image context shares this
    // buffer so the cut-out can run on it.
    const source = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    for (let y = 2; y < 4; y++) {
      for (let x = 2; x < 4; x++) {
        source[(y * 8 + x) * 4] = 200;
        source[(y * 8 + x) * 4 + 1] = 40;
        source[(y * 8 + x) * 4 + 2] = 40;
      }
    }
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const fillRect = vi.fn();
    const sharedContext = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage,
      fillStyle: '',
      fillRect,
      putImageData,
      getImageData: vi.fn(() => ({ data: source })),
      filter: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      save: vi.fn(),
      restore: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => sharedContext),
      toDataURL: vi.fn(() => 'data:image/png;base64,encoded'),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    class SmallImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 8;
      naturalHeight = 8;
      width = 8;
      height = 8;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', SmallImage);

    await expect(composeWindowsNativeIconBase64('/brand-icons/07-database-hug.webp', {
      transparentMark: true,
    })).resolves.toBe('encoded');
    // Pipeline: rasterise the source, silhouette shadow at the fitted rect
    // (slightly offset downwards), blurred dark shadow, then the crisp mark.
    // No tile fill beyond the shadow silhouette itself.
    expect(drawImage.mock.calls[0]).toEqual([expect.anything(), 0, 0]);
    expect(drawImage.mock.calls[1]).toEqual([
      expect.anything(),
      2,
      2,
      2,
      2,
      16,
      16,
      993,
      993,
    ]);
    expect(drawImage.mock.calls[2]).toEqual([
      expect.anything(),
      16,
      46,
      993,
      993,
    ]);
    expect(drawImage.mock.calls[3]).toEqual([
      expect.anything(),
      2,
      2,
      2,
      2,
      16,
      16,
      993,
      993,
    ]);
    expect(fillRect).toHaveBeenCalledTimes(1);
    expect(fillRect.mock.calls[0]).toEqual([0, 0, 1024, 1024]);
    expect(sharedContext.fillStyle).toBe('#0f172a');
  });
});
