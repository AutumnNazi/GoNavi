import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_IMAGE_MAX_DATA_URL_CHARS,
  BACKGROUND_IMAGE_MAX_FILE_BYTES,
  BackgroundImageError,
  isBackgroundImageDataUrl,
  prepareBackgroundImage,
  sanitizeBackgroundImage,
} from './backgroundImage';

// Encoding/decoding are browser APIs mocked here; this is not a JPEG codec test.
const JPEG_URL = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xe0\x00\x00\xff\xd9')}`;
const signatures: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/webp': [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
};
const makeFile = (type = 'image/png') => new File([new Uint8Array(signatures[type] ?? [])], 'photo.png', { type });

const drawImage = vi.fn();
const fillRect = vi.fn();
const toDataURL = vi.fn(() => JPEG_URL);
const revokeObjectURL = vi.fn();
const createObjectURL = vi.fn(() => 'blob:local-test');
const context = { drawImage, fillRect, fillStyle: '', imageSmoothingQuality: '' };
const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toDataURL };
let width = 3840;
let height = 2160;
let decodeFails = false;
let instances: FakeImage[] = [];

class FakeImage {
  naturalWidth = width;
  naturalHeight = height;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { instances.push(this); }
  set src(_value: string) {
    queueMicrotask(() => decodeFails ? this.onerror?.() : this.onload?.());
  }
}

beforeEach(() => {
  width = 3840;
  height = 2160;
  decodeFails = false;
  instances = [];
  vi.resetAllMocks();
  toDataURL.mockReturnValue(JPEG_URL);
  canvas.getContext.mockReturnValue(context);
  createObjectURL.mockReturnValue('blob:local-test');
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
});
afterEach(() => vi.unstubAllGlobals());

describe('background image import', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('decodes %s and normalizes to JPEG', async (type) => {
    expect(await prepareBackgroundImage(makeFile(type))).toEqual({ dataUrl: JPEG_URL, name: 'photo.png' });
    expect(canvas.getContext).toHaveBeenCalledWith('2d');
    expect(drawImage).toHaveBeenCalledWith(instances[0], 0, 0, 1920, 1080);
    expect(context.fillStyle).toBe('#ffffff');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-test');
    expect(instances[0].onload).toBeNull();
    expect(instances[0].onerror).toBeNull();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it.each([
    [1080, 3840, 540, 1920],
    [120, 80, 120, 80],
    [1, 10000, 1, 1920],
  ])('scales %sx%s without enlargement or zero dimensions', async (w, h, expectedW, expectedH) => {
    width = w;
    height = h;
    await prepareBackgroundImage(makeFile());
    expect(drawImage).toHaveBeenCalledWith(instances[0], 0, 0, expectedW, expectedH);
  });

  it.each(['image/svg+xml', 'image/gif', 'text/plain', 'image/jpg', ''])('rejects MIME %s before decoding', async (type) => {
    await expect(prepareBackgroundImage(makeFile(type))).rejects.toMatchObject({ code: 'invalid-type' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'])('rejects SVG/GIF disguised as %s', async (type) => {
    for (const content of ['<svg xmlns="http://www.w3.org/2000/svg"/>', 'GIF89a']) {
      await expect(prepareBackgroundImage(new File([content], 'photo.png', { type })))
        .rejects.toMatchObject({ code: 'invalid-image' });
    }
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('allows exactly 10 MiB but rejects larger files before reading', async () => {
    const bytes = new Uint8Array(BACKGROUND_IMAGE_MAX_FILE_BYTES);
    bytes.set(signatures['image/png']);
    await expect(prepareBackgroundImage(new File([bytes], 'large.png', { type: 'image/png' })))
      .resolves.toMatchObject({ dataUrl: JPEG_URL });
    createObjectURL.mockClear();
    await expect(prepareBackgroundImage(new File([bytes, 'x'], 'large.png', { type: 'image/png' })))
      .rejects.toMatchObject({ code: 'too-large' });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects empty files', async () => {
    await expect(prepareBackgroundImage(new File([], 'empty.png', { type: 'image/png' })))
      .rejects.toBeInstanceOf(BackgroundImageError);
  });

  it('requires successful Image decoding, not just a valid file header', async () => {
    decodeFails = true;
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
    expect(toDataURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(instances[0].onerror).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid decoded dimensions %s', async (value) => {
    width = value;
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('reduces JPEG quality when the first output exceeds the character budget', async () => {
    toDataURL.mockReturnValueOnce('x'.repeat(BACKGROUND_IMAGE_MAX_DATA_URL_CHARS + 1));
    await expect(prepareBackgroundImage(makeFile())).resolves.toMatchObject({ dataUrl: JPEG_URL });
    expect(toDataURL.mock.calls).toEqual([['image/jpeg', 0.82], ['image/jpeg', 0.72]]);
  });

  it('rejects output that still exceeds the budget after bounded retries', async () => {
    toDataURL.mockReturnValue('x'.repeat(BACKGROUND_IMAGE_MAX_DATA_URL_CHARS + 1));
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'too-large' });
    expect(toDataURL).toHaveBeenCalledTimes(6);
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });

  it.each(['data:,', 'data:image/png;base64,AAAA', 'https://example.com/a.jpg'])('rejects invalid canvas output %s', async (value) => {
    toDataURL.mockReturnValue(value);
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
  });

  it('normalizes read, canvas and object URL errors', async () => {
    const file = makeFile();
    vi.spyOn(file, 'slice').mockImplementationOnce(() => { throw new Error('read failed'); });
    await expect(prepareBackgroundImage(file)).rejects.toMatchObject({ code: 'invalid-image' });
    expect(createObjectURL).not.toHaveBeenCalled();
    createObjectURL.mockImplementationOnce(() => { throw new Error('unavailable'); });
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
    canvas.getContext.mockReturnValueOnce(null as unknown as typeof context);
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
    drawImage.mockImplementationOnce(() => { throw new Error('draw failed'); });
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
    toDataURL.mockImplementationOnce(() => { throw new Error('encode failed'); });
    await expect(prepareBackgroundImage(makeFile())).rejects.toMatchObject({ code: 'invalid-image' });
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });
});

describe('persisted background image validation', () => {
  it('accepts only a bounded, canonical JPEG data URL and copies known fields', () => {
    expect(isBackgroundImageDataUrl(JPEG_URL)).toBe(true);
    expect(sanitizeBackgroundImage({ dataUrl: JPEG_URL, name: 'photo.png', extra: true }))
      .toEqual({ dataUrl: JPEG_URL, name: 'photo.png' });
  });

  it.each([
    '', null, 42, 'https://example.com/image.jpg', 'blob:local', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGODlh',
    'data:image/jpeg;charset=utf-8;base64,/9j/2Q==', 'DATA:image/jpeg;base64,/9j/2Q==',
    'data:image/jpeg;base64,', 'data:image/jpeg;base64,AAAA',
    'data:image/jpeg;base64,/9j/2Q', 'data:image/jpeg;base64,/9j/2R==',
    `${JPEG_URL}\n`, `${JPEG_URL} `, `${JPEG_URL}');background:url(https://example.com)`,
    `data:image/jpeg;base64,${'A'.repeat(BACKGROUND_IMAGE_MAX_DATA_URL_CHARS)}`,
  ])('rejects untrusted data URL case %#', (value) => {
    expect(isBackgroundImageDataUrl(value)).toBe(false);
  });

  it.each([null, [], {}, { dataUrl: JPEG_URL }, { dataUrl: JPEG_URL, name: 1 }])('rejects malformed image case %#', (value) => {
    expect(sanitizeBackgroundImage(value)).toBeNull();
  });
});
