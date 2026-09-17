import { isTableDesignerNativeColumnEditorTarget } from './tableDesignerColumnClipboard';

export type TableDesignerClipboardKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

const isPrimaryModifierPressed = (event: TableDesignerClipboardKeyEvent): boolean => (
  !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey)
);

export const isTableDesignerColumnCopyKey = (event: TableDesignerClipboardKeyEvent): boolean => (
  isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'c'
);

export const isTableDesignerColumnPasteKey = (event: TableDesignerClipboardKeyEvent): boolean => (
  isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'v'
);

export const hasTableDesignerNativeTextSelection = (target: EventTarget | null): boolean => {
  if (!target || typeof HTMLInputElement === 'undefined') return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    return start !== null && end !== null && start !== end;
  }
  if (!isTableDesignerNativeColumnEditorTarget(target)) return false;
  const selection = globalThis.getSelection?.();
  return !!selection && !selection.isCollapsed && String(selection.toString()).length > 0;
};

export const resolveTableDesignerColumnClipboardShortcut = (
  event: TableDesignerClipboardKeyEvent,
  options: {
    selectedCount: number;
    readOnly: boolean;
    shortcutEnabled: boolean;
    hasInAppColumns: boolean;
  },
): 'copy' | 'paste' | null => {
  if (!options.shortcutEnabled) return null;
  if (
    isTableDesignerColumnCopyKey(event)
    && options.selectedCount > 0
    && !hasTableDesignerNativeTextSelection(event.target)
  ) {
    return 'copy';
  }
  if (!isTableDesignerColumnPasteKey(event) || options.readOnly) return null;
  if (hasTableDesignerNativeTextSelection(event.target)) return null;
  if (options.hasInAppColumns) return 'paste';
  return isTableDesignerNativeColumnEditorTarget(event.target) ? null : 'paste';
};
