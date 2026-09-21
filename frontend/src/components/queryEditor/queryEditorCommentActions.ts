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
  /** 菜单 action 携带的键位（enabled 且改绑时为改后组合键；含默认键位时菜单显示键位提示） */
  keybindings?: number[];
  /**
   * 需要吞键的平台默认组合键（Ctrl/Cmd+/）：恒为空操作，仅压制内置同键位，
   * 避免与设置中心的改键冲突检测打架。与菜单 action 分离——
   * 禁用快捷键不影响右键菜单入口。
   */
  swallowKeybinding?: { keyMod: number; keyCode: number } | null;
  run: () => void;
}

export interface QueryEditorDisposable {
  dispose(): void;
}

export function registerQueryEditorCommentAction(
  input: RegisterQueryEditorCommentActionInput,
): QueryEditorDisposable | null {
  const { editor, label, keybindings, swallowKeybinding, run } = input;
  if (!editor || typeof editor.addAction !== 'function') {
    return null;
  }
  const disposables: QueryEditorDisposable[] = [];
  // 菜单 action：右键入口不受快捷键禁用影响，始终可用
  disposables.push(editor.addAction({
    id: QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID,
    label,
    precondition: QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION,
    contextMenuGroupId: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP,
    contextMenuOrder: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER,
    ...(keybindings && keybindings.length > 0 ? { keybindings } : {}),
    run,
  }));
  if (swallowKeybinding && typeof editor.addCommand === 'function') {
    // 默认 Ctrl(Cmd)+/ 的占用命令（addCommand 不进右键菜单）：
    // enabled 时委托切换注释并压制内置同键位；disabled 时吞键。
    const commandId = editor.addCommand(swallowKeybinding.keyMod | swallowKeybinding.keyCode, () => {});
    if (typeof commandId === 'number' || typeof commandId === 'string') {
      disposables.push({ dispose: () => editor.removeCommand?.(commandId) });
    }
  }
  return {
    dispose: () => disposables.forEach((disposable) => disposable?.dispose?.()),
  };
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

// 解析「取消/添加注释」的键位方案：
// - enabled 且未改绑：菜单 action 携带平台默认 Ctrl(Cmd)+/（压制内置同键位）；
// - enabled 且改绑：菜单 action 携带新键位，默认键位作为吞键命令压制内置；
// - disabled：菜单保留（不受禁用影响），默认键位仅吞键。
export function resolveToggleLineCommentBindingPlan(input: {
  platform: 'mac' | 'windows';
  combo?: string;
  enabled?: boolean;
  keyModEnum: Record<string, number>;
  keyCodeEnum: Record<string, number>;
}): {
  menuKeybindings: number[];
  swallowKeybinding: { keyMod: number; keyCode: number } | null;
} {
  const { platform, combo, enabled, keyModEnum, keyCodeEnum } = input;
  const defaultCombo = DEFAULT_SHORTCUT_OPTIONS.toggleLineComment[platform].combo;
  const defaultKeyBinding = comboToMonacoKeyBinding(defaultCombo, keyModEnum, keyCodeEnum, platform);
  const normalizedCombo = normalizeShortcutCombo(String(combo || ''));
  const usingCustomCombo = Boolean(enabled)
    && Boolean(normalizedCombo)
    && normalizedCombo !== normalizeShortcutCombo(defaultCombo);
  const customKeyBinding = usingCustomCombo
    ? comboToMonacoKeyBinding(String(normalizedCombo), keyModEnum, keyCodeEnum, platform)
    : null;

  if (!enabled) {
    return {
      menuKeybindings: [],
      swallowKeybinding: defaultKeyBinding,
    };
  }
  if (customKeyBinding) {
    return {
      menuKeybindings: [customKeyBinding.keyMod | customKeyBinding.keyCode],
      swallowKeybinding: defaultKeyBinding,
    };
  }
  return {
    menuKeybindings: defaultKeyBinding
      ? [defaultKeyBinding.keyMod | defaultKeyBinding.keyCode]
      : [],
    swallowKeybinding: null,
  };
}
