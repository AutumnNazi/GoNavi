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
  /** 可选：设置中心分配的组合键（comboToMonacoKeyBinding 的产物） */
  keyMod?: number;
  keyCode?: number;
  run: () => void;
}

export interface QueryEditorDisposable {
  dispose(): void;
}

export function registerQueryEditorCommentAction(
  input: RegisterQueryEditorCommentActionInput,
): QueryEditorDisposable | null {
  const { editor, label, keyMod, keyCode, run } = input;
  if (!editor || typeof editor.addAction !== 'function') {
    return null;
  }
  const keybindings: number[] = [];
  if (typeof keyMod === 'number' && typeof keyCode === 'number') {
    keybindings.push(keyMod | keyCode);
  }
  return editor.addAction({
    id: QUERY_EDITOR_TOGGLE_LINE_COMMENT_ACTION_ID,
    label,
    precondition: QUERY_EDITOR_TOGGLE_LINE_COMMENT_PRECONDITION,
    contextMenuGroupId: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_GROUP,
    contextMenuOrder: QUERY_EDITOR_TOGGLE_LINE_COMMENT_MENU_ORDER,
    ...(keybindings.length > 0 ? { keybindings } : {}),
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
