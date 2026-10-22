import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import type { I18nParams } from '../../../i18n';
import {
  compactJsonCellText,
  escapeCellText,
  formatJsonCellText,
  unescapeCellText,
} from '../../../utils/dataGridCellTextTransform';
import { registerNacosJsonParserAction } from '../nacosJsonParser';

export interface UseNacosJsonParserInput {
  tr: (key: string, params?: I18nParams) => string;
  readOnly: boolean;
}

export const useNacosJsonParser = ({ tr, readOnly }: UseNacosJsonParserInput) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const originalTextRef = useRef('');
  const rangeRef = useRef<unknown>(null);
  const editorRef = useRef<any>(null);
  const [editorVersion, setEditorVersion] = useState(0);

  const handleEditorMount = useCallback((editor: any) => {
    editorRef.current = editor;
    setEditorVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    return registerNacosJsonParserAction(editor, {
      label: tr('nacos_viewer.action.json_parser'),
      onOpen: ({ text, range }) => {
        originalTextRef.current = text;
        rangeRef.current = range;
        setValue(text);
        setOpen(true);
      },
    });
  }, [editorVersion, tr]);

  const close = useCallback(() => setOpen(false), []);

  const apply = useCallback(() => {
    const editor = editorRef.current;
    const range = rangeRef.current;
    if (editor && range && value !== originalTextRef.current) {
      editor.executeEdits?.('gonavi.nacos.jsonParser', [
        { range, text: value, forceMoveMarkers: true },
      ]);
      editor.focus?.();
    }
    setOpen(false);
  }, [value]);

  const runTransform = useCallback(
    (transform: (input: string) => string, errorKey: string) => {
      try {
        setValue(transform(value));
      } catch (error: any) {
        void message.error(tr(errorKey, { error: error?.message || String(error) }));
      }
    },
    [tr, value],
  );

  const escape = useCallback(
    () => runTransform(escapeCellText, 'nacos_viewer.message.json_parser_invalid_escape'),
    [runTransform],
  );
  const unescape = useCallback(
    () => runTransform(unescapeCellText, 'nacos_viewer.message.json_parser_invalid_escape'),
    [runTransform],
  );
  const format = useCallback(
    () => runTransform(formatJsonCellText, 'nacos_viewer.message.json_parser_invalid_json'),
    [runTransform],
  );
  const compact = useCallback(
    () => runTransform(compactJsonCellText, 'nacos_viewer.message.json_parser_invalid_json'),
    [runTransform],
  );

  return {
    open,
    value,
    readOnly,
    setValue,
    close,
    apply,
    escape,
    unescape,
    format,
    compact,
    handleEditorMount,
  };
};

export type NacosJsonParserApi = ReturnType<typeof useNacosJsonParser>;
