import { comboToMonacoKeyBinding } from '../../utils/shortcuts';

// 通用「设置中心可配置快捷键 → Monaco action」注册器：组合键禁用或无法
// 解析时返回 null（调用方据此不登记 ref），由各自 effect 的清理函数负责释放。
// resolveToggleLineCommentKeybindings 一类的特殊键位策略在各自模块中解析后，
// 也可通过 rawKeybindings 直接传入。

export interface QueryEditorShortcutRegistration {
  editor: any;
  monaco: any;
  platform: 'mac' | 'windows';
  id: string;
  label: string;
  combo?: string;
  enabled?: boolean;
  run?: (editor: any) => void;
  /** 可选：跳过 comboToMonacoKeyBinding，直接使用已解析的键位 */
  rawKeybindings?: number[];
}

export interface QueryEditorDisposable {
  dispose(): void;
}

export function registerQueryEditorShortcutAction(
  input: QueryEditorShortcutRegistration,
): QueryEditorDisposable | null {
  const { editor, monaco, platform, id, label, combo, enabled, rawKeybindings } = input;
  if (!editor || typeof editor.addAction !== 'function') {
    return null;
  }
  const keybindings = rawKeybindings && rawKeybindings.length > 0
    ? rawKeybindings
    : (() => {
      if (!enabled || !combo) {
        return null;
      }
      const keyBinding = comboToMonacoKeyBinding(combo, monaco.KeyMod, monaco.KeyCode, platform);
      return keyBinding ? [keyBinding.keyMod | keyBinding.keyCode] : null;
    })();
  if (!keybindings) {
    return null;
  }
  return editor.addAction({
    id,
    label,
    keybindings,
    run: () => input.run?.(editor),
  });
}
