import { describe, expect, it, vi } from 'vitest';

import {
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION,
  registerQueryEditorCommentAction,
  runMonacoToggleLineComment,
} from './queryEditorCommentActions';

const createFakeEditor = () => {
  const registered: Array<{ id: string; options: Record<string, unknown> }> = [];
  const innerActionRun = vi.fn();
  const editor: Record<string, any> = {
    addAction: vi.fn((options: Record<string, unknown>) => {
      registered.push({ id: String(options.id), options });
      return { dispose: vi.fn() };
    }),
    getAction: vi.fn((actionId: string) => (
      actionId === QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID
        ? { run: innerActionRun }
        : null
    )),
    trigger: vi.fn(),
  };
  return { editor, registered, innerActionRun };
};

describe('registerQueryEditorCommentAction', () => {
  it('registers the context menu action with group, order and precondition', () => {
    const { editor, registered } = createFakeEditor();

    const disposable = registerQueryEditorCommentAction({
      editor,
      label: '取消/添加注释',
      run: () => {},
    });

    expect(disposable).not.toBeNull();
    expect(registered).toHaveLength(1);
    expect(registered[0].id).toBe(QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID);
    expect(registered[0].options).toEqual(expect.objectContaining({
      label: '取消/添加注释',
      precondition: QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION,
      contextMenuGroupId: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP,
      contextMenuOrder: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER,
    }));
    expect(registered[0].options.keybindings).toBeUndefined();
  });

  it('attaches keybindings only when a resolved binding is provided', () => {
    const { editor, registered } = createFakeEditor();

    registerQueryEditorCommentAction({
      editor,
      label: 'Toggle Line Comment',
      keyMod: 2,
      keyCode: 191,
      run: () => {},
    });

    expect(registered[0].options.keybindings).toEqual([2 | 191]);
  });

  it('returns null for an unusable editor', () => {
    expect(registerQueryEditorCommentAction({ editor: null, label: 'x', run: () => {} })).toBeNull();
    expect(registerQueryEditorCommentAction({ editor: {}, label: 'x', run: () => {} })).toBeNull();
  });

  it('delegates run to the built-in comment line command via runMonacoToggleLineComment', () => {
    const { editor, innerActionRun } = createFakeEditor();

    expect(runMonacoToggleLineComment(editor)).toBe(true);
    expect(innerActionRun).toHaveBeenCalledTimes(1);
  });

  it('falls back to editor.trigger when the built-in action is unavailable', () => {
    const editor: Record<string, any> = { getAction: vi.fn(() => null), trigger: vi.fn() };

    expect(runMonacoToggleLineComment(editor)).toBe(true);
    expect(editor.trigger).toHaveBeenCalledWith('source', QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID, null);
  });

  it('returns false for an unusable editor', () => {
    expect(runMonacoToggleLineComment(null)).toBe(false);
    expect(runMonacoToggleLineComment({})).toBe(false);
  });

  it('keeps the built-in command id aligned with the Monaco comment action', () => {
    expect(QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID).toBe('editor.action.commentLine');
  });
});
