import React from 'react';
import { Button, message, Tooltip } from 'antd';
import Editor from './MonacoEditor';
import { t as defaultTranslate, type I18nParams } from '../i18n';

export type DataGridRecordViewTranslate = (key: string, params?: I18nParams) => string;

interface DataGridJsonViewProps {
  darkMode: boolean;
  rowCount: number;
  canModifyData: boolean;
  jsonViewText: string;
  translate?: DataGridRecordViewTranslate;
  onOpenJsonEditor: () => void;
  onReturnToTable: () => void;
}

export const DataGridJsonView: React.FC<DataGridJsonViewProps> = ({
  darkMode,
  rowCount,
  canModifyData,
  jsonViewText,
  translate = defaultTranslate,
  onOpenJsonEditor,
  onReturnToTable,
}) => (
  <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '8px 10px', borderBottom: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: darkMode ? '#999' : '#666' }}>
        {rowCount === 0
          ? translate('data_grid.record_view.empty')
          : translate('data_grid.record_view.json_record_count', { count: rowCount })}
      </span>
      {canModifyData && (
        <Button size="small" type="primary" onClick={onOpenJsonEditor} disabled={rowCount === 0}>
          {translate('data_grid.record_view.edit_json')}
        </Button>
      )}
      <Button size="small" onClick={onReturnToTable}>
        {translate('data_grid.record_view.back_to_table')}
      </Button>
    </div>
    <div style={{ flex: 1, minHeight: 0, padding: '8px 10px 10px 10px' }}>
      <Editor
        height="100%"
        gonaviTypography="data"
        defaultLanguage="json"
        language="json"
        theme={darkMode ? 'transparent-dark' : 'transparent-light'}
        value={jsonViewText}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          fontSize: 12,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    </div>
  </div>
);

interface DataGridTextViewProps {
  darkMode: boolean;
  rowCount: number;
  textRecordIndex: number;
  canModifyData: boolean;
  currentTextRow: Record<string, any> | null;
  displayOutputColumnNames: string[];
  columnMetaMap?: Record<string, { type?: string; comment?: string }>;
  columnMetaMapByLowerName?: Record<string, { type?: string; comment?: string }>;
  showColumnType?: boolean;
  showColumnComment?: boolean;
  translate?: DataGridRecordViewTranslate;
  onPrev: () => void;
  onNext: () => void;
  onEditCurrent: () => void;
  onReturnToTable: () => void;
  formatTextViewValue: (value: any, columnName?: string) => string;
}

interface DataGridTextCellProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-grid-text-view-cell'?: string;
  'data-grid-text-value-copy'?: string;
}

interface DataGridTextOverflowCellProps extends DataGridTextCellProps {
  value: string;
  cellBaseStyle: React.CSSProperties;
  tooltipInnerStyle: React.CSSProperties;
}

const DataGridTextOverflowCell: React.FC<DataGridTextOverflowCellProps> = ({
  value,
  cellBaseStyle,
  tooltipInnerStyle,
  ...props
}) => {
  const cellRef = React.useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = React.useState(false);

  const measureTruncation = React.useCallback(() => {
    const cell = cellRef.current;
    const nextIsTruncated = Boolean(value)
      && Boolean(cell?.clientWidth)
      && Boolean(cell && cell.scrollWidth > cell.clientWidth);
    setIsTruncated((previous) => (previous === nextIsTruncated ? previous : nextIsTruncated));
  }, [value]);

  React.useEffect(() => {
    measureTruncation();
    const cell = cellRef.current;
    if (!cell || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(measureTruncation);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [measureTruncation]);

  const cell = (
    <div
      {...props}
      ref={cellRef}
      style={{ ...cellBaseStyle, ...props.style }}
      onMouseEnter={(event) => {
        measureTruncation();
        props.onMouseEnter?.(event);
      }}
    >
      {value}
    </div>
  );

  return (
    <Tooltip
      title={isTruncated && value ? <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</span> : undefined}
      overlayInnerStyle={tooltipInnerStyle}
    >
      {cell}
    </Tooltip>
  );
};

export const DataGridTextView: React.FC<DataGridTextViewProps> = ({
  darkMode,
  rowCount,
  textRecordIndex,
  canModifyData,
  currentTextRow,
  displayOutputColumnNames,
  columnMetaMap = {},
  columnMetaMapByLowerName = {},
  showColumnType = true,
  showColumnComment = true,
  translate = defaultTranslate,
  onPrev,
  onNext,
  onEditCurrent,
  onReturnToTable,
  formatTextViewValue,
}) => {
  const metaTextColor = darkMode ? 'rgba(255,255,255,0.52)' : 'rgba(0,0,0,0.48)';
  const primaryTextColor = darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.88)';
  const valueTextColor = darkMode ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)';
  const gridTemplateColumns = '180px 140px 240px minmax(260px, 1fr)';
  const gridMinWidth = 820;
  const cellBaseStyle: React.CSSProperties = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '8px 10px',
    lineHeight: '20px',
  };
  const tooltipInnerStyle: React.CSSProperties = {
    maxWidth: 560,
    maxHeight: '60vh',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  const copyValue = React.useCallback(async (value: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
      void message.success(translate('data_grid.message.copied_to_clipboard'));
    } catch {
      void message.error(translate('connection_modal.message.copy_failed'));
    }
  }, [translate]);

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button size="small" onClick={onPrev} disabled={rowCount === 0 || textRecordIndex <= 0}>
          {translate('data_grid.record_view.previous')}
        </Button>
        <Button size="small" onClick={onNext} disabled={rowCount === 0 || textRecordIndex >= rowCount - 1}>
          {translate('data_grid.record_view.next')}
        </Button>
        <span style={{ fontSize: 12, color: darkMode ? '#999' : '#666' }}>
          {rowCount === 0
            ? translate('data_grid.record_view.empty')
            : translate('data_grid.record_view.record_position', { current: textRecordIndex + 1, total: rowCount })}
        </span>
        {canModifyData && (
          <Button size="small" type="primary" onClick={onEditCurrent} disabled={rowCount === 0}>
            {translate('data_grid.record_view.edit_current')}
          </Button>
        )}
        <Button size="small" onClick={onReturnToTable}>
          {translate('data_grid.record_view.back_to_table')}
        </Button>
      </div>
      <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
        <div style={{ minWidth: gridMinWidth }}>
          <div
            role="row"
            style={{
              display: 'grid',
              gridTemplateColumns,
              borderBottom: darkMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              background: darkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
            }}
          >
            {[
              ['field', 'data_grid.record_view.field'],
              ['type', 'data_grid.record_view.type'],
              ['comment', 'data_grid.record_view.comment'],
              ['value', 'data_grid.record_view.value'],
            ].map(([key, label]) => (
              <div
                key={key}
                role="columnheader"
                data-grid-text-view-header={key}
                style={{ ...cellBaseStyle, color: metaTextColor, fontWeight: 600 }}
              >
                {translate(label)}
              </div>
            ))}
          </div>
          {currentTextRow ? displayOutputColumnNames.map((col) => {
            const columnMeta = columnMetaMap[col] || columnMetaMapByLowerName[col.toLowerCase()];
            const columnType = String(columnMeta?.type || '').trim();
            const columnComment = String(columnMeta?.comment || '').trim();
            const formattedValue = formatTextViewValue(currentTextRow[col], col);
            const borderBottom = darkMode ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)';

            return (
              <div
                key={col}
                role="row"
                style={{ display: 'grid', gridTemplateColumns, borderBottom }}
              >
                <DataGridTextOverflowCell
                  value={col}
                  cellBaseStyle={cellBaseStyle}
                  tooltipInnerStyle={tooltipInnerStyle}
                  style={{ fontWeight: 600, color: primaryTextColor }}
                  data-grid-text-view-cell="field"
                />
                <DataGridTextOverflowCell
                  value={showColumnType ? columnType : ''}
                  cellBaseStyle={cellBaseStyle}
                  tooltipInnerStyle={tooltipInnerStyle}
                  style={{ color: metaTextColor }}
                  data-grid-text-view-cell="type"
                />
                <DataGridTextOverflowCell
                  value={showColumnComment ? columnComment : ''}
                  cellBaseStyle={cellBaseStyle}
                  tooltipInnerStyle={tooltipInnerStyle}
                  style={{ color: metaTextColor }}
                  data-grid-text-view-cell="comment"
                />
                <DataGridTextOverflowCell
                  value={formattedValue}
                  cellBaseStyle={cellBaseStyle}
                  tooltipInnerStyle={tooltipInnerStyle}
                  style={{ color: valueTextColor, fontWeight: 400, cursor: 'copy' }}
                  data-grid-text-view-cell="value"
                  data-grid-text-value-copy="true"
                  role="button"
                  tabIndex={0}
                  aria-label={translate('data_grid.record_view.copy_value')}
                  onClick={() => { void copyValue(formattedValue); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void copyValue(formattedValue);
                    }
                  }}
                />
              </div>
            );
          }) : (
            <div
              style={{ ...cellBaseStyle, gridColumn: '1 / -1', color: darkMode ? '#999' : '#666' }}
            >
              {translate('data_grid.record_view.empty')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
