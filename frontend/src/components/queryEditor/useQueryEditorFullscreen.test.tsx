/** @vitest-environment jsdom */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetQueryEditorTabSplitRatiosForTests } from '../../utils/queryEditorSplitLayout';
import { DEFAULT_SHORTCUT_OPTIONS, type ShortcutOptions } from '../../utils/shortcuts';
import { useQueryEditorFullscreen } from './useQueryEditorFullscreen';

let dispatchTarget: HTMLElement | null = null;

const pressKey = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  (dispatchTarget as HTMLElement).dispatchEvent(event);
};

interface HarnessProps {
  isActive?: boolean;
  platform?: 'mac' | 'windows';
  shortcutOptions?: ShortcutOptions;
  editorHasFocus?: boolean;
  inQueryEditor?: boolean;
  editorHeight?: number;
  resultsPanelVisible?: boolean;
}

let latest: ReturnType<typeof useQueryEditorFullscreen>;

const Harness: React.FC<HarnessProps> = ({
  isActive = true,
  platform = 'windows',
  shortcutOptions = DEFAULT_SHORTCUT_OPTIONS,
  editorHasFocus = true,
  inQueryEditor = false,
  editorHeight = 300,
  resultsPanelVisible = true,
}) => {
  latest = useQueryEditorFullscreen({
    isActive,
    shortcutOptions,
    activeShortcutPlatform: platform,
    editorRef: { current: editorHasFocus ? { hasTextFocus: () => true } : null },
    rootRef: { current: inQueryEditor ? ({ contains: () => true } as unknown as HTMLElement) : null },
    editorHeight,
    resultsPanelVisible,
  });
  return null;
};

describe('useQueryEditorFullscreen', () => {
  beforeEach(() => {
    resetQueryEditorTabSplitRatiosForTests();
    document.body.innerHTML = '';
    const container = document.createElement('div');
    container.setAttribute('data-test', 'outside-app');
    document.body.appendChild(container);
    dispatchTarget = container;
  });

  it('starts inactive and keeps the ratio-driven stage style', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness editorHeight={420} />); });
    expect(latest.active).toBe(false);
    expect(latest.resultsAreaMounted).toBe(true);
    expect(latest.stageStyle).toEqual({ height: 420, minHeight: '100px' });
    act(() => { tree.unmount(); });
  });

  it('toggles via the returned callback and switches the stage to fill mode', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness />); });
    act(() => { latest.toggle(); });
    expect(latest.active).toBe(true);
    expect(latest.resultsAreaMounted).toBe(false);
    expect(latest.stageStyle).toEqual({ flex: '1 1 auto', minHeight: 0 });
    act(() => { latest.toggle(); });
    expect(latest.active).toBe(false);
    act(() => { tree.unmount(); });
  });

  it('toggles fullscreen with the default F11 shortcut when the editor has focus', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness />); });
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(true);
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(false);
    act(() => { tree.unmount(); });
  });

  it('ignores the shortcut when focus is outside the query editor', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness editorHasFocus={false} inQueryEditor={false} />); });
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(false);
    act(() => { tree.unmount(); });
  });

  it('accepts events from inside the query editor root even without editor text focus', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness editorHasFocus={false} inQueryEditor />); });
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(true);
    act(() => { tree.unmount(); });
  });

  it('ignores the shortcut when the tab is inactive', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness isActive={false} />); });
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(false);
    act(() => { tree.unmount(); });
  });

  it('uses the platform binding: mac default is Ctrl+F11, bare F11 does not match', () => {
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness platform="mac" />); });
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(false);
    act(() => { pressKey('F11', { ctrlKey: true }); });
    expect(latest.active).toBe(true);
    act(() => { tree.unmount(); });
  });

  it('does nothing when the binding is disabled', () => {
    const options: ShortcutOptions = {
      ...DEFAULT_SHORTCUT_OPTIONS,
      toggleEditorFullscreen: {
        mac: { combo: 'Ctrl+F11', enabled: false },
        windows: { combo: '', enabled: false },
      },
    };
    let tree: ReactTestRenderer;
    act(() => { tree = create(<Harness shortcutOptions={options} />); });
    act(() => { pressKey('F11'); });
    expect(latest.active).toBe(false);
    act(() => { tree.unmount(); });
  });
});
