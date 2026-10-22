import { unescapeCellText } from '../../utils/dataGridCellTextTransform';

export const NACOS_JSON_PARSER_ACTION_ID = 'gonavi.nacos.openJsonParser';
export const NACOS_JSON_SELECTION_CONTEXT_KEY = 'gonaviNacosJsonSelection';

export interface NacosJsonParserSelection {
  text: string;
  range: unknown;
}

export interface RegisterNacosJsonParserActionOptions {
  label: string;
  onOpen: (selection: NacosJsonParserSelection) => void;
}

const canParseJson = (value: string): boolean => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

// 选中内容可能是原始 JSON，也可能是被反斜杠转义过的 JSON 片段（如 {\"a\":1}）。
export const isJsonLikeText = (value: string): boolean => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return false;
  if (canParseJson(trimmed)) return true;
  // 无转义符时无需走反转义，避免对超大非 JSON 选区做无谓的全量扫描。
  if (!trimmed.includes('\\')) return false;
  try {
    const unescaped = unescapeCellText(trimmed);
    return unescaped !== trimmed && canParseJson(unescaped);
  } catch {
    return false;
  }
};

export const registerNacosJsonParserAction = (
  editor: any,
  options: RegisterNacosJsonParserActionOptions,
): (() => void) => {
  // Monaco 0.55 的 createContextKey 只挂在编辑器实例上，monaco.editor 上没有该 API。
  if (!editor?.addAction || typeof editor.createContextKey !== 'function') {
    return () => {};
  }

  const contextKey = editor.createContextKey(NACOS_JSON_SELECTION_CONTEXT_KEY, false);
  const readSelection = (): NacosJsonParserSelection | null => {
    const model = editor.getModel?.();
    const range = editor.getSelection?.();
    if (!model || !range) return null;
    return { text: String(model.getValueInRange(range) ?? ''), range };
  };
  const refresh = () => {
    const selection = readSelection();
    contextKey.set(!!selection && isJsonLikeText(selection.text));
  };

  const action = editor.addAction({
    id: NACOS_JSON_PARSER_ACTION_ID,
    label: options.label,
    precondition: NACOS_JSON_SELECTION_CONTEXT_KEY,
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 10,
    run: () => {
      const selection = readSelection();
      if (!selection || !isJsonLikeText(selection.text)) return;
      options.onOpen(selection);
    },
  });

  const selectionDisposable = editor.onDidChangeCursorSelection?.(refresh);
  const contentDisposable = editor.onDidChangeModelContent?.(refresh);
  refresh();

  return () => {
    action?.dispose?.();
    selectionDisposable?.dispose?.();
    contentDisposable?.dispose?.();
    contextKey?.reset?.();
  };
};
