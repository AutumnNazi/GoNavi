import { useCallback } from 'react';
import { message } from 'antd';
import type { MenuProps } from 'antd';
import { t, type I18nParams } from '../i18n';
import {
  applyTableDesignerColumnPaste,
  parseTableDesignerColumns,
  readTableDesignerColumnsClipboard,
  recallTableDesignerColumnsClipboard,
  rememberTableDesignerColumnsClipboard,
  serializeTableDesignerColumns,
  writeTableDesignerColumnsClipboard,
  type TableDesignerClipboardColumn,
} from './tableDesignerColumnClipboard';
import {
  hasTableDesignerNativeTextSelection,
  resolveTableDesignerColumnClipboardShortcut,
} from './tableDesignerColumnClipboardShortcuts';

type ClipboardEventTarget = {
  clipboardData: {
    getData: (type: string) => string;
    setData: (type: string, value: string) => void;
  };
  preventDefault: () => void;
  target: EventTarget | null;
};

type Translate = (key: string, params?: I18nParams) => string;

export const useTableDesignerColumnClipboard = ({
  readOnly,
  language,
  columns,
  selectedColumns,
  setColumns,
  setSelectedColumnRowKeys,
  pendingFocusColumnKeyRef,
  onCopyToTable,
  shortcutEnabled = true,
}: {
  readOnly: boolean;
  language: string;
  columns: TableDesignerClipboardColumn[];
  selectedColumns: TableDesignerClipboardColumn[];
  setColumns: (updater: (previous: TableDesignerClipboardColumn[]) => TableDesignerClipboardColumn[]) => void;
  setSelectedColumnRowKeys: (keys: string[]) => void;
  pendingFocusColumnKeyRef: { current: string | null };
  onCopyToTable?: () => void;
  shortcutEnabled?: boolean;
}) => {
  const translate: Translate = useCallback(
    (key, params) => t(key, params, language),
    [language],
  );

  const applyPaste = useCallback((pastedColumns: TableDesignerClipboardColumn[]) => {
    const result = applyTableDesignerColumnPaste(pastedColumns, columns);
    if (result.columns.length === 0) return { count: 0, strippedPrimaryKey: false };
    setColumns((previous) => [...previous, ...result.columns]);
    setSelectedColumnRowKeys(result.pastedKeys);
    pendingFocusColumnKeyRef.current = result.pastedKeys[0] || null;
    return { count: result.columns.length, strippedPrimaryKey: result.strippedPrimaryKey };
  }, [columns, pendingFocusColumnKeyRef, setColumns, setSelectedColumnRowKeys]);

  const handleCopyEvent = useCallback((event: ClipboardEventTarget) => {
    if (selectedColumns.length === 0 || hasTableDesignerNativeTextSelection(event.target)) return;
    rememberTableDesignerColumnsClipboard(selectedColumns);
    event.clipboardData.setData('text/plain', serializeTableDesignerColumns(selectedColumns));
    event.preventDefault();
  }, [selectedColumns]);

  const handlePasteEvent = useCallback((event: ClipboardEventTarget) => {
    if (readOnly || hasTableDesignerNativeTextSelection(event.target)) return;
    const pastedColumns = parseTableDesignerColumns(event.clipboardData.getData('text/plain'))
      || recallTableDesignerColumnsClipboard();
    if (!pastedColumns || pastedColumns.length === 0) return;
    applyPaste(pastedColumns);
    event.preventDefault();
  }, [applyPaste, readOnly]);

  const copySelected = useCallback(async () => {
    const result = await writeTableDesignerColumnsClipboard(selectedColumns);
    if (result === 'empty') {
      message.warning(translate('table_designer.message.select_columns_to_copy'));
      return;
    }
    if (result === 'failed') {
      message.error(translate('table_designer.message.clipboard_write_failed'));
      return;
    }
    message.success(translate('table_designer.message.columns_copied', { count: selectedColumns.length }));
  }, [selectedColumns, translate]);

  const pasteFromClipboard = useCallback(async () => {
    if (readOnly) return;
    const pastedColumns = await readTableDesignerColumnsClipboard();
    if (!pastedColumns || pastedColumns.length === 0) {
      message.warning(translate('table_designer.message.clipboard_empty'));
      return;
    }
    const pasted = applyPaste(pastedColumns);
    if (pasted.count > 0) {
      message.success(translate('table_designer.message.columns_pasted', { count: pasted.count }));
      if (pasted.strippedPrimaryKey) {
        message.info(translate('table_designer.copy_columns.pk_stripped_hint'));
      }
    }
  }, [applyPaste, readOnly, translate]);

  const handleKeyDown = useCallback((event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }) => {
    const action = resolveTableDesignerColumnClipboardShortcut(event, {
      selectedCount: selectedColumns.length,
      readOnly,
      shortcutEnabled,
      hasInAppColumns: Boolean(recallTableDesignerColumnsClipboard()),
    });
    if (action === 'copy') {
      event.preventDefault();
      event.stopPropagation();
      void copySelected();
      return;
    }
    if (action === 'paste') {
      event.preventDefault();
      event.stopPropagation();
      void pasteFromClipboard();
    }
  }, [copySelected, pasteFromClipboard, readOnly, selectedColumns.length, shortcutEnabled]);

  const contextMenuItems: MenuProps['items'] = [
    {
      key: 'copy-columns',
      label: translate('table_designer.action.copy_columns'),
      disabled: selectedColumns.length === 0,
      onClick: () => { void copySelected(); },
    },
    {
      key: 'paste-columns',
      label: translate('table_designer.action.paste_columns'),
      disabled: readOnly,
      onClick: () => { void pasteFromClipboard(); },
    },
    ...(readOnly || !onCopyToTable ? [] : [{
      type: 'divider' as const,
    }, {
      key: 'copy-columns-to-table',
      label: translate('table_designer.action.copy_columns_to_table'),
      disabled: selectedColumns.length === 0,
      onClick: () => onCopyToTable(),
    }]),
  ];

  return {
    handleCopyEvent,
    handlePasteEvent,
    handleKeyDown,
    copySelected,
    pasteFromClipboard,
    contextMenuItems,
  };
};
