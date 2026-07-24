import React from 'react';

type GridRecord = Record<string, any>;

export interface DataGridFocusedCellInfo {
  record: GridRecord;
  dataIndex: string;
  title: string;
}

interface UseDataGridPreviewPanelParams {
  previewAvailable: boolean;
  toEditableText: (value: any, columnName?: string) => string;
  looksLikeJsonText: (text: string) => boolean;
  normalizeDateTimeString: (value: string) => string;
}

export interface UseDataGridPreviewPanelResult {
  dataPanelOpen: boolean;
  dataPanelOpenRef: React.MutableRefObject<boolean>;
  focusedCellInfo: DataGridFocusedCellInfo | null;
  dataPanelValue: string;
  setDataPanelValue: React.Dispatch<React.SetStateAction<string>>;
  dataPanelIsJson: boolean;
  dataPanelDirtyRef: React.MutableRefObject<boolean>;
  dataPanelOriginalRef: React.MutableRefObject<string>;
  toggleDataPanel: () => void;
  updateFocusedCell: (record: GridRecord, dataIndex: string) => void;
  handleDataPanelFormatJson: (onError: (message: string) => void) => void;
}

export const useDataGridPreviewPanel = ({
  previewAvailable,
  toEditableText,
  looksLikeJsonText,
  normalizeDateTimeString,
}: UseDataGridPreviewPanelParams): UseDataGridPreviewPanelResult => {
  const [dataPanelOpen, setDataPanelOpen] = React.useState(false);
  const dataPanelOpenRef = React.useRef(false);
  const [focusedCellInfo, setFocusedCellInfo] = React.useState<DataGridFocusedCellInfo | null>(null);
  const [dataPanelValue, setDataPanelValue] = React.useState('');
  const [dataPanelIsJson, setDataPanelIsJson] = React.useState(false);
  const dataPanelDirtyRef = React.useRef(false);
  const dataPanelOriginalRef = React.useRef('');

  const closeDataPanel = React.useCallback(() => {
    dataPanelOpenRef.current = false;
    setDataPanelOpen(false);
    setFocusedCellInfo(null);
    setDataPanelValue('');
    setDataPanelIsJson(false);
    dataPanelDirtyRef.current = false;
    dataPanelOriginalRef.current = '';
  }, []);

  const updateFocusedCell = React.useCallback((record: GridRecord, dataIndex: string) => {
    if (!record || !dataIndex) return;
    const raw = record?.[dataIndex];
    let text = toEditableText(raw, dataIndex);
    if (typeof raw === 'string' && text === raw) {
      text = normalizeDateTimeString(raw);
    }
    const isJson = looksLikeJsonText(text);
    setFocusedCellInfo({ record, dataIndex, title: dataIndex });
    dataPanelOriginalRef.current = text;
    setDataPanelValue(text);
    setDataPanelIsJson(isJson);
    dataPanelDirtyRef.current = false;
  }, [looksLikeJsonText, normalizeDateTimeString, toEditableText]);

  const handleDataPanelFormatJson = React.useCallback((onError: (message: string) => void) => {
    if (!dataPanelIsJson) return;
    try {
      const obj = JSON.parse(dataPanelValue);
      setDataPanelValue(JSON.stringify(obj, null, 2));
      dataPanelDirtyRef.current = true;
    } catch (error: any) {
      onError(error?.message || String(error));
    }
  }, [dataPanelIsJson, dataPanelValue]);

  const toggleDataPanel = React.useCallback(() => {
    if (!previewAvailable) {
      closeDataPanel();
      return;
    }
    const next = !dataPanelOpenRef.current;
    dataPanelOpenRef.current = next;
    setDataPanelOpen(next);
    if (!next) {
      closeDataPanel();
    }
  }, [closeDataPanel, previewAvailable]);

  React.useEffect(() => {
    if (!previewAvailable) {
      closeDataPanel();
    }
  }, [closeDataPanel, previewAvailable]);

  React.useEffect(() => {
    dataPanelOpenRef.current = dataPanelOpen;
  }, [dataPanelOpen]);

  return {
    dataPanelOpen: previewAvailable && dataPanelOpen,
    dataPanelOpenRef,
    focusedCellInfo,
    dataPanelValue,
    setDataPanelValue,
    dataPanelIsJson,
    dataPanelDirtyRef,
    dataPanelOriginalRef,
    toggleDataPanel,
    updateFocusedCell,
    handleDataPanelFormatJson,
  };
};
