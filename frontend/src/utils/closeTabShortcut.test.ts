import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SHORTCUT_OPTIONS, cloneShortcutOptions } from './shortcuts';
import {
  CLOSE_SHORTCUT_BACKGROUND_BLOCKER_SELECTOR,
  dispatchCloseActiveResultTab,
  getPlatformNativeCloseCombo,
  hasVisibleCloseShortcutBackgroundBlocker,
  resolveCloseShortcutKeydownDecision,
  resolveCloseShortcutScopeFromTarget,
  resolveDockedActiveTabId,
} from './closeTabShortcut';

const keyEvent = (overrides: Partial<{
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}> = {}) => ({
  key: 'w',
  code: 'KeyW',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 87,
  ...overrides,
});

describe('close tab shortcut routing decision', () => {
  it('routes the enabled platform default to closeActiveTab', () => {
    expect(resolveCloseShortcutKeydownDecision({
      event: keyEvent({ metaKey: true }),
      shortcutOptions: DEFAULT_SHORTCUT_OPTIONS,
      platform: 'mac',
      capturingShortcut: false,
      imeComposing: false,
      interactionBlocked: false,
    })).toEqual({
      kind: 'close',
      preventDefault: true,
      stopImmediatePropagation: true,
      ownerAction: 'closeActiveTab',
    });
  });

  it('consumes the native close combo when the action is disabled', () => {
    const options = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
    options.closeActiveTab.windows.enabled = false;
    expect(resolveCloseShortcutKeydownDecision({
      event: keyEvent({ ctrlKey: true }),
      shortcutOptions: options,
      platform: 'windows',
      capturingShortcut: false,
      imeComposing: false,
      interactionBlocked: false,
    })).toMatchObject({ kind: 'consume', ownerAction: null, preventDefault: true });
  });

  it('delegates a migrated native combo to its existing action owner', () => {
    const options = cloneShortcutOptions(DEFAULT_SHORTCUT_OPTIONS);
    options.closeActiveTab.windows.enabled = false;
    options.newQueryTab.windows.combo = 'Ctrl+W';
    expect(resolveCloseShortcutKeydownDecision({
      event: keyEvent({ ctrlKey: true }),
      shortcutOptions: options,
      platform: 'windows',
      capturingShortcut: false,
      imeComposing: false,
      interactionBlocked: false,
    })).toEqual({
      kind: 'delegate',
      preventDefault: true,
      stopImmediatePropagation: false,
      ownerAction: 'newQueryTab',
    });
  });

  it('consumes without dispatch during IME or guarded interactions', () => {
    for (const flags of [
      { imeComposing: true, interactionBlocked: false },
      { imeComposing: false, interactionBlocked: true },
    ]) {
      expect(resolveCloseShortcutKeydownDecision({
        event: keyEvent({ metaKey: true, isComposing: flags.imeComposing }),
        shortcutOptions: DEFAULT_SHORTCUT_OPTIONS,
        platform: 'mac',
        capturingShortcut: false,
        ...flags,
      })).toMatchObject({ kind: 'consume', preventDefault: true, stopImmediatePropagation: true });
    }
  });

  it('lets the recorder own the event before close routing', () => {
    expect(resolveCloseShortcutKeydownDecision({
      event: keyEvent({ metaKey: true }),
      shortcutOptions: DEFAULT_SHORTCUT_OPTIONS,
      platform: 'mac',
      capturingShortcut: true,
      imeComposing: false,
      interactionBlocked: false,
    })).toEqual({ kind: 'recording', preventDefault: false, stopImmediatePropagation: false });
  });

  it('ignores unrelated combinations', () => {
    expect(resolveCloseShortcutKeydownDecision({
      event: keyEvent({ key: 'q', code: 'KeyQ', metaKey: true }),
      shortcutOptions: DEFAULT_SHORTCUT_OPTIONS,
      platform: 'mac',
      capturingShortcut: false,
      imeComposing: false,
      interactionBlocked: false,
    })).toEqual({ kind: 'ignore', preventDefault: false, stopImmediatePropagation: false });
  });

  it('maps native close keys per platform', () => {
    expect(getPlatformNativeCloseCombo('mac')).toBe('Meta+W');
    expect(getPlatformNativeCloseCombo('windows')).toBe('Ctrl+W');
  });
});

describe('close shortcut interaction scope', () => {
  const target = (matches: Record<string, { scope?: string } | null>) => ({
    closest: vi.fn((selector: string) => {
      const match = matches[selector];
      if (!match) return null;
      return {
        getAttribute: (name: string) => name === 'data-gonavi-close-shortcut-scope'
          ? match.scope ?? null
          : null,
      };
    }),
  });

  it('prefers detached blocked ownership over a background workspace', () => {
    const node = target({
      '[data-gonavi-close-shortcut-scope="blocked"], .gn-detached-result-window, .gn-detached-window, .gn-detached-ai-chat-window, .gn-result-diff-floating-window': {},
    });
    expect(resolveCloseShortcutScopeFromTarget(node)).toBe('blocked');
  });

  it('returns the explicit result or workspace scope', () => {
    const result = target({
      '[data-gonavi-close-shortcut-scope]': { scope: 'result' },
    });
    const workspace = target({
      '[data-gonavi-close-shortcut-scope]': { scope: 'workspace' },
    });
    expect(resolveCloseShortcutScopeFromTarget(result)).toBe('result');
    expect(resolveCloseShortcutScopeFromTarget(workspace)).toBe('workspace');
  });

  it('does not let an ordinary guard change the remembered scope', () => {
    const guarded = {
      closest: vi.fn((selector: string) => selector.includes('data-gonavi-close-shortcut-guard') ? {} : null),
    };
    expect(resolveCloseShortcutScopeFromTarget(guarded)).toBeNull();
  });

  it('detects only visible background blockers', () => {
    const visible = {
      hidden: false,
      style: {},
      getAttribute: () => null,
      classList: { contains: () => false },
      ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } },
    };
    const hidden = {
      ...visible,
      style: { display: 'none' },
    };
    const documentTarget = {
      querySelectorAll: vi.fn(() => [hidden, visible]),
    };
    expect(hasVisibleCloseShortcutBackgroundBlocker(documentTarget)).toBe(true);
    expect(documentTarget.querySelectorAll).toHaveBeenCalledWith(CLOSE_SHORTCUT_BACKGROUND_BLOCKER_SELECTOR);
  });
});

describe('result close command', () => {
  it('resolves the visible docked tab independently from detached activity', () => {
    const tabs = [{ id: 'docked-1' }, { id: 'detached-1' }, { id: 'docked-2' }];
    const detached = [{ tabId: 'detached-1' }];
    expect(resolveDockedActiveTabId(tabs, 'docked-2', detached)).toBe('docked-2');
    expect(resolveDockedActiveTabId(tabs, 'detached-1', detached)).toBe('docked-1');
    expect(resolveDockedActiveTabId([{ id: 'detached-1' }], 'detached-1', detached)).toBeNull();
  });

  it('returns the synchronously mutated request outcome', () => {
    const eventTarget = {
      dispatchEvent: vi.fn((event: CustomEvent) => {
        event.detail.handled = true;
        event.detail.outcome = 'hidden';
        return true;
      }),
    };
    expect(dispatchCloseActiveResultTab('tab-1', eventTarget as unknown as Window)).toBe('hidden');
    expect(eventTarget.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ targetTabId: 'tab-1' }),
    }));
  });
});
