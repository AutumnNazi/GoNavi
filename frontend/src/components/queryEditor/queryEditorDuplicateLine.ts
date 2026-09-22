import { normalizeEditorPosition } from './QueryEditorHelpers';

// 「复制当前行到下一行」：在当前行下方插入一份拷贝，光标跟随到新行，
// 并推送撤销点保证一步撤销。供查询编辑器快捷键与右键菜单复用。

export function duplicateCurrentLineInEditor(
  editor: any,
  monaco: any,
  applyQueryState: (value: string) => void,
): void {
  const model = editor?.getModel?.();
  const normalizedPosition = normalizeEditorPosition(editor?.getPosition?.());
  if (!editor || !monaco?.Range || !model || !normalizedPosition) {
    return;
  }

  const lineNumber = normalizedPosition.lineNumber;
  const lineText = String(model.getLineContent?.(lineNumber) || '');
  const maxColumn = Number(model.getLineMaxColumn?.(lineNumber) || (lineText.length + 1));
  const modelValue = String(model.getValue?.() || '');
  const lineBreak = typeof model.getEOL?.() === 'string'
    ? model.getEOL()
    : (modelValue.includes('\r\n') ? '\r\n' : '\n');
  const insertRange = new monaco.Range(lineNumber, maxColumn, lineNumber, maxColumn);
  const nextColumn = Math.min(normalizedPosition.column, lineText.length + 1);

  editor.executeEdits?.('gonavi-duplicate-current-line', [{
    range: insertRange,
    text: `${lineBreak}${lineText}`,
    forceMoveMarkers: true,
  }]);
  editor.pushUndoStop?.();

  const nextPosition = { lineNumber: lineNumber + 1, column: nextColumn };
  const cursorSelection = new monaco.Range(
    nextPosition.lineNumber,
    nextPosition.column,
    nextPosition.lineNumber,
    nextPosition.column,
  );
  editor.setSelections?.([cursorSelection]);
  editor.setSelection?.(cursorSelection);
  editor.setPosition?.(nextPosition);
  editor.revealLineInCenterIfOutsideViewport?.(nextPosition.lineNumber);
  editor.focus?.();

  const nextValue = editor.getValue?.();
  if (typeof nextValue === 'string') {
    applyQueryState(nextValue);
  }
}
