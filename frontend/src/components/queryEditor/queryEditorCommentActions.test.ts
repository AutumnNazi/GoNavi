import { describe, expect, it, vi } from 'vitest';

import {
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID,
  QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION,
  registerQueryEditorCommentAction,
  resolveToggleLineCommentBindingPlan,
  runMonacoToggleLineComment,
} from './queryEditorCommentActions';

const KEY_MOD_ENUM = { CtrlCmd: 2, Shift: 4, Alt: 8 };
const KEY_CODE_ENUM = { Slash: 90, KeyC: 33 };
// 平台默认 Ctrl+/ 的 keyMod|keyCode（windows）
const DEFAULT_SWALLOW_KEY = 2 | 90;
const CUSTOM_SWALLOW_KEY = 8 | 33;

function createFakeEditor() {
  const registered: Array<{ id: string; options: Record<string, unknown> }> = [];
  const commands: Array<{ id: string | number; keyMod: number; handler: () => void }> = [];
  const innerActionRun = vi.fn();
  const editor: Record<string, any> = {
    addAction: vi.fn((options: Record<string, unknown>) => {
      registered.push({ id: String(options.id), options });
      return { dispose: vi.fn() };
    }),
    addCommand: vi.fn((keyBinding: number, handler: () => void) => {
      const id = commands.length + 1;
      commands.push({ id, keyMod: keyBinding, handler });
      return id;
    }),
    removeCommand: vi.fn(),
    getAction: vi.fn((actionId: string) => (
      actionId === QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID
        ? { run: innerActionRun }
        : null
    )),
    trigger: vi.fn(),
  };
  return { editor, registered, commands, innerActionRun };
}

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

  it('attaches menu keybindings only when provided', () => {
    const { editor, registered } = createFakeEditor();

    registerQueryEditorCommentAction({
      editor,
      label: 'Toggle Line Comment',
      keybindings: [2 | 90],
      run: () => {},
    });

    expect(registered[0].options.keybindings).toEqual([2 | 90]);
  });

  it('registers a no-op swallow command on the default combo to suppress the built-in binding', () => {
    const { editor, commands, innerActionRun } = createFakeEditor();

    const disposable = registerQueryEditorCommentAction({
      editor,
      label: '取消/添加注释',
      swallowKeybinding: { keyMod: 2, keyCode: 90 },
      run: () => runMonacoToggleLineComment(editor),
    });

    expect(editor.addCommand).toHaveBeenCalledWith(DEFAULT_SWALLOW_KEY, expect.any(Function));
    // 吞键命令恒为空操作：压制内置 Ctrl(Cmd)+/，不产生第二次注释切换
    commands[0].handler();
    expect(innerActionRun).not.toHaveBeenCalled();
    disposable?.dispose();
    expect(editor.removeCommand).toHaveBeenCalledWith(1);
  });

  it('disposes the swallow command via removeCommand', () => {
    const { editor } = createFakeEditor();

    const disposable = registerQueryEditorCommentAction({
      editor,
      label: '取消/添加注释',
      swallowKeybinding: { keyMod: 2, keyCode: 90 },
      run: () => {},
    });
    disposable?.dispose();

    expect(editor.removeCommand).toHaveBeenCalledWith(1);
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

describe('resolveToggleLineCommentBindingPlan', () => {
  const planInput = (overrides: Partial<Parameters<typeof resolveToggleLineCommentBindingPlan>[0]> = {}) => ({
    platform: 'windows' as const,
    keyModEnum: KEY_MOD_ENUM,
    keyCodeEnum: KEY_CODE_ENUM,
    ...overrides,
  });

  it('enabled with default combo: menu carries Ctrl+/ and no swallow command is needed', () => {
    const plan = resolveToggleLineCommentBindingPlan(planInput({
      combo: 'Ctrl+/',
      enabled: true,
    }));
    expect(plan.menuKeybindings).toEqual([DEFAULT_SWALLOW_KEY]);
    expect(plan.swallowKeybinding).toBeNull();
  });

  it('enabled with a rebound combo: menu carries the new combo and the default is swallowed', () => {
    const plan = resolveToggleLineCommentBindingPlan(planInput({
      combo: 'Alt+C',
      enabled: true,
    }));
    expect(plan.menuKeybindings).toEqual([CUSTOM_SWALLOW_KEY]);
    expect(plan.swallowKeybinding).toEqual({ keyMod: 2, keyCode: 90 });
  });

  it('disabled: menu carries nothing and the default combo is swallowed', () => {
    const plan = resolveToggleLineCommentBindingPlan(planInput({
      combo: 'Ctrl+/',
      enabled: false,
    }));
    expect(plan.menuKeybindings).toEqual([]);
    expect(plan.swallowKeybinding).toEqual({ keyMod: 2, keyCode: 90 });
  });

  it('mac default resolves to Meta+/ (CtrlCmd abstraction)', () => {
    const plan = resolveToggleLineCommentBindingPlan(planInput({
      platform: 'mac',
      combo: 'Meta+/',
      enabled: true,
    }));
    expect(plan.menuKeybindings).toEqual([2 | 90]);
    expect(plan.swallowKeybinding).toBeNull();
  });
});
