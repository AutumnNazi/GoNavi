/** @vitest-environment jsdom */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUT_OPTIONS, SHORTCUT_ACTION_ORDER, setGlobalShortcutCaptureActive } from '../../utils/shortcuts';
import { useQueryEditorAIAction } from './useQueryEditorAIAction';
import { injectQueryEditorAiPromptWithContext } from './queryEditorAiPromptInject';
vi.mock('./queryEditorAiPromptInject', () => ({ injectQueryEditorAiPromptWithContext: vi.fn() }));

describe('AI optimize shortcut', () => {
  it('follows AI diagnose in settings', () => {
    expect(SHORTCUT_ACTION_ORDER.indexOf('optimizeQueryWithAI')).toBe(SHORTCUT_ACTION_ORDER.indexOf('diagnoseExecutionError') + 1);
  });
  it('uses current selection, falls back to full SQL, and respects active, disabled and recording states', () => {
    const send = vi.mocked(injectQueryEditorAiPromptWithContext);
    send.mockClear();
    function Harness({ selection = '', active = true, enabled = true, combo = 'Ctrl+Alt+O', database = 'first' }) {
      useQueryEditorAIAction({ isActive: active, platform: 'windows',
        shortcuts: { ...DEFAULT_SHORTCUT_OPTIONS, optimizeQueryWithAI: { ...DEFAULT_SHORTCUT_OPTIONS.optimizeQueryWithAI, windows: { enabled, combo } } },
        getSelection: () => selection, getSQL: () => 'SELECT whole_table', placeholder: '<SQL>', connection: undefined, database, openGenerate: vi.fn() });
      return null;
    }
    const key = (value = 'o', composing = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey: true, altKey: true, bubbles: true, cancelable: true, isComposing: composing }));
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<Harness selection="SELECT selected_column" />); });
    try {
      act(() => { key(); });
      expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: expect.stringContaining('SELECT selected_column') }));
      act(() => tree.update(<Harness database="second" />));
      act(() => { key(); });
      expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ database: 'second', prompt: expect.stringContaining('SELECT whole_table') }));
      send.mockClear();
      setGlobalShortcutCaptureActive(true);
      act(() => { key(); });
      setGlobalShortcutCaptureActive(false);
      act(() => { key('o', true); });
      act(() => tree.update(<Harness active={false} />));
      act(() => { key(); });
      act(() => tree.update(<Harness enabled={false} />));
      act(() => { key(); });
      expect(send).not.toHaveBeenCalled();
      act(() => tree.update(<Harness combo="Ctrl+Alt+U" />));
      act(() => { key(); });
      expect(send).not.toHaveBeenCalled();
      act(() => { key('u'); });
      expect(send).toHaveBeenCalledOnce();
    } finally { setGlobalShortcutCaptureActive(false); act(() => tree.unmount()); }
  });
});
