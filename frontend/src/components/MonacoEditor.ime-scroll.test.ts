import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installWebKitImeScrollStabilizer } from './MonacoEditor';

class FakeTextAreaElement {
  scrollLeft = 0;
  scrollTop = 0;

  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

describe('MonacoEditor WebKit IME scroll stabilizer', () => {
  let input: FakeTextAreaElement;
  let disposeListener: (() => void) | null;
  let editor: any;

  beforeEach(() => {
    input = new FakeTextAreaElement();
    disposeListener = null;
    vi.stubGlobal('HTMLTextAreaElement', FakeTextAreaElement);
    editor = {
      getDomNode: () => ({
        querySelector: () => input,
      }),
      onDidDispose: vi.fn((listener: () => void) => {
        disposeListener = listener;
      }),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps Monaco textarea offsets stable throughout WebKit composition', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/620.1.2 (KHTML, like Gecko)',
    });
    input.scrollTop = 26;
    input.scrollLeft = 118;

    installWebKitImeScrollStabilizer(editor);
    input.dispatch('compositionstart');

    input.scrollTop = 52;
    input.scrollLeft = 141;
    input.dispatch('compositionupdate');

    expect(input.scrollTop).toBe(26);
    expect(input.scrollLeft).toBe(118);

    input.scrollTop = 73;
    input.scrollLeft = 166;
    input.dispatch('scroll');

    expect(input.scrollTop).toBe(26);
    expect(input.scrollLeft).toBe(118);

    input.dispatch('compositionend');
    input.scrollTop = 91;
    input.scrollLeft = 204;
    input.dispatch('scroll');

    expect(input.scrollTop).toBe(91);
    expect(input.scrollLeft).toBe(204);
  });

  it('does not interfere with Chromium textarea scrolling', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });

    installWebKitImeScrollStabilizer(editor);
    input.scrollTop = 12;
    input.scrollLeft = 34;
    input.dispatch('compositionstart');
    input.scrollTop = 56;
    input.scrollLeft = 78;
    input.dispatch('compositionupdate');

    expect(input.scrollTop).toBe(56);
    expect(input.scrollLeft).toBe(78);
    expect(editor.onDidDispose).not.toHaveBeenCalled();
  });

  it('removes the WebKit workaround when Monaco is disposed', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/620.1.2 (KHTML, like Gecko)',
    });

    installWebKitImeScrollStabilizer(editor);
    input.scrollTop = 10;
    input.scrollLeft = 20;
    input.dispatch('compositionstart');
    disposeListener?.();

    input.scrollTop = 30;
    input.scrollLeft = 40;
    input.dispatch('compositionupdate');

    expect(input.scrollTop).toBe(30);
    expect(input.scrollLeft).toBe(40);
  });
});
