import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { copyDataGridClipboard } from './copyDataGridClipboard';
import { writeClipboardPayload } from '../../dataGridClipboardPayload';

vi.mock('antd', () => ({ message: { success: vi.fn(), error: vi.fn() } }));
const translate = (key: string) => key;
const payload = { plainText: '58524', html: '<table><tr><td>58524</td></tr></table>' };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const nativeClipboard = (write: (text: string) => Promise<boolean>) => {
  vi.stubGlobal('window', { runtime: { ClipboardSetText: write } });
};

describe('data grid clipboard write and feedback', () => {
  it('waits for clipboard completion before reporting success', async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const pending = copyDataGridClipboard(payload, translate);
    expect(writeText).toHaveBeenCalledWith('58524');
    expect(message.success).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(message.success).toHaveBeenCalledOnce();
    expect(message.error).not.toHaveBeenCalled();
  });

  it('reports failure rather than success when writes are rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await copyDataGridClipboard(payload, translate);
    expect(message.success).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledOnce();
  });

  it('uses native clipboard when browser text writing is rejected', async () => {
    const write = vi.fn().mockResolvedValue(true);
    nativeClipboard(write);
    await expect(writeClipboardPayload(payload, { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith('58524');
  });

  it('uses native clipboard when browser clipboard is unavailable', async () => {
    const write = vi.fn().mockResolvedValue(true);
    nativeClipboard(write);
    await expect(writeClipboardPayload(payload, {})).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith('58524');
  });

  it.each([false, undefined])('does not accept native result %s as success', async (result) => {
    const write = vi.fn().mockResolvedValue(result);
    nativeClipboard(write);
    await expect(writeClipboardPayload(payload, {})).rejects.toThrow('Native clipboard write failed');
    expect(write).toHaveBeenCalledWith('58524');
  });

  it.each([true, false])('reports the native write outcome %s through the copy action', async (result) => {
    vi.stubGlobal('navigator', {});
    const write = vi.fn().mockResolvedValue(result);
    nativeClipboard(write);
    await copyDataGridClipboard(payload, translate);
    expect(write).toHaveBeenCalledWith('58524');
    expect(message.success).toHaveBeenCalledTimes(result ? 1 : 0);
    expect(message.error).toHaveBeenCalledTimes(result ? 0 : 1);
  });

  it('propagates native errors when no writer succeeds', async () => {
    nativeClipboard(vi.fn().mockRejectedValue(new Error('native denied')));
    await expect(writeClipboardPayload(payload, {})).rejects.toThrow();
  });

  it('does not overwrite successful browser rich data with native plain text', async () => {
    vi.stubGlobal('ClipboardItem', class { constructor(public parts: Record<string, Blob>) {} });
    const native = vi.fn().mockResolvedValue(true);
    nativeClipboard(native);
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    await writeClipboardPayload(payload, { write, writeText });
    expect(write).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it('falls back through rejected rich and text writes to native text', async () => {
    vi.stubGlobal('ClipboardItem', class { constructor(public parts: Record<string, Blob>) {} });
    const native = vi.fn().mockResolvedValue(true);
    nativeClipboard(native);
    await writeClipboardPayload(payload, {
      write: vi.fn().mockRejectedValue(new Error('unsupported MIME')),
      writeText: vi.fn().mockRejectedValue(new Error('denied')),
    });
    expect(native).toHaveBeenCalledWith('58524');
  });

  it('does not report success or modify the clipboard for an empty payload', async () => {
    const writeText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyDataGridClipboard('', translate);
    expect(writeText).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });
});
