import { describe, expect, it } from 'vitest';

import {
  BOOT_SPLASH_ID,
  hideBootSplash,
  resolveBootSplashErrorMessage,
  showBootSplashError,
} from './bootSplash';

type FakeNode = {
  attributes: Record<string, string>;
  textContent: string;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  querySelector: (selector: string) => FakeNode | null;
};

const createSplashDocument = () => {
  const message: FakeNode = {
    attributes: {},
    textContent: 'Starting',
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    querySelector: () => null,
  };
  const splash: FakeNode = {
    attributes: { 'data-state': 'loading' },
    textContent: '',
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    querySelector: (selector) => (selector === '[data-boot-message]' ? message : null),
  };
  return {
    splash,
    message,
    document: {
      getElementById: (id: string) => (id === BOOT_SPLASH_ID ? splash : null),
    },
  };
};

describe('bootSplash', () => {
  it('hides the out-of-root splash so React can own the surface', () => {
    const { splash, document: doc } = createSplashDocument();
    hideBootSplash(doc);
    expect(splash.getAttribute('hidden')).toBe('');
    expect(splash.getAttribute('data-state')).toBe('hidden');
  });

  it('keeps Windows WebView2 guidance in the boot error instead of a blank window', () => {
    const { splash, message, document: doc } = createSplashDocument();
    showBootSplashError('chunk load failed', doc, 'zh-CN', true);
    expect(splash.getAttribute('data-state')).toBe('error');
    expect(splash.hasAttribute('hidden')).toBe(false);
    expect(message.textContent).toContain('WebView2');
    expect(message.textContent).toContain('chunk load failed');
  });

  it('resolves bilingual WebView2 guidance', () => {
    expect(resolveBootSplashErrorMessage('boom', 'en-US', true)).toContain('WebView2 Runtime');
    expect(resolveBootSplashErrorMessage('', 'zh-CN', false)).toBe('界面未能加载。');
  });

  it('ignores non-element getElementById results from test renderers', () => {
    hideBootSplash({ getElementById: () => ({}) as unknown as HTMLElement });
    showBootSplashError('no-op', { getElementById: () => ({}) as unknown as HTMLElement });
  });
});
