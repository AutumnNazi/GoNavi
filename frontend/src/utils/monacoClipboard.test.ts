import { describe, expect, it, vi } from 'vitest';

import {
  installWailsMonacoClipboardPasteCommand,
  readClipboardTextWithFallback,
} from './monacoClipboard';

describe('Monaco clipboard fallback', () => {
  it('uses the primary clipboard reader when it can read text', async () => {
    const primaryReadText = vi.fn().mockResolvedValue('native text');
    const fallbackReadText = vi.fn().mockResolvedValue('browser text');

    await expect(readClipboardTextWithFallback(primaryReadText, fallbackReadText))
      .resolves.toBe('native text');
    expect(fallbackReadText).not.toHaveBeenCalled();
  });

  it('falls back when the primary clipboard reader rejects the read', async () => {
    const primaryReadText = vi.fn().mockRejectedValue(new Error('native clipboard unavailable'));
    const fallbackReadText = vi.fn().mockResolvedValue('SELECT * FROM users;');

    await expect(readClipboardTextWithFallback(primaryReadText, fallbackReadText))
      .resolves.toBe('SELECT * FROM users;');
  });

  it('overrides Monaco paste with the Wails clipboard and restores the command after the last editor unmounts', async () => {
    const browserReadText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const wailsReadText = vi.fn().mockResolvedValue('native text');
    const trigger = vi.fn();
    const focusedEditor = {
      getRawOptions: () => ({ readOnly: false }),
      hasModel: () => true,
      hasTextFocus: () => true,
      trigger,
    };
    let registeredCommand: (() => Promise<void>) | undefined;
    const dispose = vi.fn();
    const monaco = {
      editor: {
        addCommand: vi.fn((descriptor) => {
          registeredCommand = descriptor.run;
          return { dispose };
        }),
        getEditors: vi.fn(() => [focusedEditor]),
      },
    };
    const scope = {
      navigator: { clipboard: { readText: browserReadText } },
      window: {
        WailsInvoke: vi.fn(),
        runtime: { ClipboardGetText: wailsReadText },
      },
    };

    const releaseFirst = installWailsMonacoClipboardPasteCommand(monaco, scope);
    const releaseSecond = installWailsMonacoClipboardPasteCommand(monaco, scope);

    await registeredCommand?.();
    expect(browserReadText).not.toHaveBeenCalled();
    expect(wailsReadText).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('keyboard', 'paste', {
      text: 'native text',
      pasteOnNewLine: false,
      multicursorText: null,
      mode: null,
    });

    releaseFirst();
    expect(dispose).not.toHaveBeenCalled();
    releaseSecond();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('uses the browser reader if the Wails clipboard is temporarily unavailable', async () => {
    const browserReadText = vi.fn().mockResolvedValue('browser text');
    const wailsReadText = vi.fn().mockRejectedValue(new Error('native clipboard unavailable'));
    const trigger = vi.fn();
    let registeredCommand: (() => Promise<void>) | undefined;
    const monaco = {
      editor: {
        addCommand: vi.fn((descriptor) => {
          registeredCommand = descriptor.run;
          return { dispose: vi.fn() };
        }),
        getEditors: vi.fn(() => [{
          getRawOptions: () => ({ readOnly: false }),
          hasModel: () => true,
          hasTextFocus: () => true,
          trigger,
        }]),
      },
    };
    const release = installWailsMonacoClipboardPasteCommand(monaco, {
      navigator: { clipboard: { readText: browserReadText } },
      window: {
        WailsInvoke: vi.fn(),
        runtime: { ClipboardGetText: wailsReadText },
      },
    });

    await registeredCommand?.();
    expect(wailsReadText).toHaveBeenCalledTimes(1);
    expect(browserReadText).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('keyboard', 'paste', expect.objectContaining({ text: 'browser text' }));
    release();
  });

  it('does not override Monaco in a regular browser runtime without the native Wails bridge', () => {
    const addCommand = vi.fn();
    const release = installWailsMonacoClipboardPasteCommand({
      editor: {
        addCommand,
        getEditors: vi.fn(() => []),
      },
    }, {
      navigator: { clipboard: { readText: vi.fn().mockResolvedValue('browser text') } },
      window: {
        runtime: { ClipboardGetText: vi.fn().mockResolvedValue('bridge text') },
      },
    });

    expect(addCommand).not.toHaveBeenCalled();
    release();
  });

  it('does not paste into a read-only editor', async () => {
    const trigger = vi.fn();
    let registeredCommand: (() => Promise<void>) | undefined;
    const release = installWailsMonacoClipboardPasteCommand({
      editor: {
        addCommand: vi.fn((descriptor) => {
          registeredCommand = descriptor.run;
          return { dispose: vi.fn() };
        }),
        getEditors: vi.fn(() => [{
          getRawOptions: () => ({ readOnly: true }),
          hasModel: () => true,
          hasTextFocus: () => true,
          trigger,
        }]),
      },
    }, {
      window: {
        WailsInvoke: vi.fn(),
        runtime: { ClipboardGetText: vi.fn().mockResolvedValue('must not paste') },
      },
    });

    await registeredCommand?.();
    expect(trigger).not.toHaveBeenCalled();
    release();
  });
});
