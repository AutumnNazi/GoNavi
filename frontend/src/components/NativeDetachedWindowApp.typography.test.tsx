// @vitest-environment jsdom
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MONO_FONT_FAMILY, DEFAULT_UI_FONT_FAMILY } from '../utils/fontFamilies';
import NativeDetachedWindowApp from './NativeDetachedWindowApp';

type FontPreferences = {
  customUIFontFamily: string | null;
  customMonoFontFamily: string | null;
};

const { preferences, listeners } = vi.hoisted(() => ({
  preferences: { current: { customUIFontFamily: null, customMonoFontFamily: null } as FontPreferences },
  listeners: new Set<() => void>(),
}));

vi.mock('../store', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useStore: (selector: (state: { appearance: FontPreferences }) => unknown) => {
      const appearance = useSyncExternalStore(
        (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        () => preferences.current,
      );
      return selector({ appearance });
    },
  };
});

vi.mock('./nativeDetachedWindow/hooks/useNativeDetachedWindowState', () => ({
  useNativeDetachedWindowState: () => ({ fontSize: 14, uiScale: 1, bootstrap: null }),
}));
vi.mock('./nativeDetachedWindow/hooks/useNativeDetachedWindowSync', () => ({
  useNativeDetachedWindowSync: () => ({}),
}));
vi.mock('./nativeDetachedWindow/hooks/useNativeDetachedWindowLifecycle', () => ({
  useNativeDetachedWindowLifecycle: () => ({ isDark: false, customThemeAntTokens: {}, chromeLabels: {} }),
}));
vi.mock('./theme/CustomThemeStyleHost', () => ({ default: () => null }));
vi.mock('./theme/ToolbarAppearanceStyleHost', () => ({ default: () => null }));
vi.mock('./nativeDetachedWindow/NativeDetachedWindowContent', () => ({ NativeDetachedWindowContent: () => null }));
vi.mock('./nativeDetachedWindow/nativeDetachedLazyParts', () => ({ NativeDetachedWindowController: () => null }));
vi.mock('antd', () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Button: () => null,
  Spin: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  theme: { darkAlgorithm: 'dark', defaultAlgorithm: 'light' },
}));

const customUI = '"ComicShannsMono Nerd Font Mono", sans-serif';
const customMono = '"Fira Code", monospace';
let renderer: TestRenderer.ReactTestRenderer | undefined;

const updatePreferences = (patch: Partial<FontPreferences>) => {
  act(() => {
    preferences.current = { ...preferences.current, ...patch };
    listeners.forEach(listener => listener());
  });
};

const expectDocumentFonts = (ui: string, mono: string) => {
  for (const element of [document.documentElement, document.body]) {
    expect(element.style.getPropertyValue('--gn-font-sans')).toBe(ui);
    expect(element.style.getPropertyValue('--gn-font-mono')).toBe(mono);
  }
  expect(renderer?.root.findByType(ConfigProvider).props.theme.token).toMatchObject({
    fontFamily: ui,
    fontFamilyCode: mono,
  });
};

describe('NativeDetachedWindowApp font settings', () => {
  beforeEach(() => {
    preferences.current = { customUIFontFamily: customUI, customMonoFontFamily: customMono };
    listeners.clear();
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('applies both font settings to the detached document and Ant Design before paint', () => {
    act(() => { renderer = TestRenderer.create(<NativeDetachedWindowApp />); });
    expectDocumentFonts(customUI, customMono);
  });

  it('responds to host font changes without remounting or changing the other font', () => {
    act(() => { renderer = TestRenderer.create(<NativeDetachedWindowApp />); });
    updatePreferences({ customUIFontFamily: '"Microsoft YaHei", sans-serif' });
    expectDocumentFonts('"Microsoft YaHei", sans-serif', customMono);
    updatePreferences({ customMonoFontFamily: '"Consolas", monospace' });
    expectDocumentFonts('"Microsoft YaHei", sans-serif', '"Consolas", monospace');
  });

  it('restores both default fonts when custom settings are cleared', () => {
    act(() => { renderer = TestRenderer.create(<NativeDetachedWindowApp />); });
    updatePreferences({ customUIFontFamily: null, customMonoFontFamily: null });
    expectDocumentFonts(DEFAULT_UI_FONT_FAMILY, DEFAULT_MONO_FONT_FAMILY);
  });

  it('replaces stale document fonts when the window starts with default settings', () => {
    preferences.current = { customUIFontFamily: null, customMonoFontFamily: null };
    document.body.style.setProperty('--gn-font-sans', customUI);
    document.documentElement.style.setProperty('--gn-font-mono', customMono);
    act(() => { renderer = TestRenderer.create(<NativeDetachedWindowApp />); });
    expectDocumentFonts(DEFAULT_UI_FONT_FAMILY, DEFAULT_MONO_FONT_FAMILY);
  });
});
