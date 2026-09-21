import { comboToMonacoKeyBinding, normalizeShortcutCombo, DEFAULT_SHORTCUT_OPTIONS } from '../../utils/shortcuts';

// 「取消/添加注释」右键菜单与快捷键的注册常量。
// 菜单项委托 Monaco 内置命令 editor.action.commentLine（切换行注释，
// 对当前行或选区生效，撤销一步即可还原），不在本地重复实现注释逻辑。

export const QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID = 'gonavi.queryEditor.toggleLineComment';
export const QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID = 'editor.action.commentLine';
// 与大小写转换菜单同组（1_modification），排在其后
export const QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP = '1_modification';
export const QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER = 3;
export const QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION = '!editorReadonly';

export interface RegisterQueryEditorCommentActionInput {
  editor: any;
  /** 右键菜单与快捷键列表显示的文案（已本地化） */
  label: string;
  /** 注册的组合键（Monaco keyMod|keyCode，通常含平台默认 Ctrl/Cmd+/ 以压制内置键位） */
  keybindings?: number[];
  run: () => void;
}

export interface QueryEditorDisposable {
  dispose(): void;
}

export function registerQueryEditorCommentAction(
  input: RegisterQueryEditorCommentActionInput,
): QueryEditorDisposable | null {
  const { editor, label, keybindings, run } = input;
  if (!editor || typeof editor.addAction !== 'function') {
    return null;
  }
  return editor.addAction({
    id: QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID,
    label,
    precondition: QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION,
    contextMenuGroupId: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP,
    contextMenuOrder: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER,
    ...(keybindings && keybindings.length > 0 ? { keybindings } : {}),
    run,
  });
}

// 供快捷键注册处解析组合键：优先走内置 action；action 缺失时回退
// editor.trigger 直发命令，行为与 VS Code 一致。
export function runMonacoToggleLineComment(editor: any): boolean {
  const action = editor?.getAction?.(QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID);
  if (action && typeof action.run === 'function') {
    void action.run();
    return true;
  }
  if (editor && typeof editor.trigger === 'function') {
    editor.trigger('source', QUERY_EDITOR_TOGGLE_LINE_COMMENT_MONACO_COMMAND_ID, null);
    return true;
  }
  return false;
}

// 解析「取消/添加注释」的 Monaco 键位：平台默认 Ctrl（Cmd）+/ 始终占用
// （enabled 时委托切换注释；disabled 时吞键，压制内置默认键位）；
// 用户改绑其它组合键时追加该键位。返回 keyMod|keyCode 列表。
export function resolveToggleLineCommentKeybindings(input: {
  platform: 'mac' | 'windows';
  combo?: string;
  enabled?: boolean;
  keyModEnum: Record<string, number>;
  keyCodeEnum: Record<string, number>;
}): number[] {
  const { platform, combo, enabled, keyModEnum, keyCodeEnum } = input;
  const defaultCombo = DEFAULT_SHORTCUT_OPTIONS.toggleLineComment[platform].combo;
  const defaultKeyBinding = comboToMonacoKeyBinding(defaultCombo, keyModEnum, keyCodeEnum, platform);
  const normalizedCombo = normalizeShortcutCombo(String(combo || ''));
  const customKeyBinding = enabled && normalizedCombo && normalizedCombo !== normalizeShortcutCombo(defaultCombo)
    ? comboToMonacoKeyBinding(normalizedCombo, keyModEnum, keyCodeEnum, platform)
    : null;
  return [defaultKeyBinding, customKeyBinding]
    .filter((entry): entry is { keyMod: number; keyCode: number } => Boolean(entry))
    .map((entry) => entry.keyMod | entry.keyCode);
}
