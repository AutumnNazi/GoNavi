import React from 'react';
import { AutoComplete, Button, Checkbox, Dropdown, Input, Select, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ClearOutlined,
  CloseOutlined,
  ConsoleSqlOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  FilterOutlined,
  ImportOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  TableOutlined,
  UndoOutlined,
  VerticalAlignBottomOutlined,
} from '@ant-design/icons';

type GridFilterCondition = {
  id: number;
  enabled?: boolean;
  logic?: string;
  column: string;
  op: string;
  value: string;
  value2?: string;
};

type GridSortInfo = {
  columnKey: string;
  order: string;
  enabled?: boolean;
};

export interface DataGridToolbarFrameProps {
  isV2Ui: boolean;
  tableName?: string;
  dbName?: string;
  translate?: (key: string, params?: Record<string, string | number>) => string;
  loading: boolean;
  darkMode: boolean;
  bgFilter: string;
  panelFrameColor: string;
  panelRadius: number;
  panelOuterGap: number;
  panelPaddingY: number;
  panelPaddingX: number;
  toolbarBottomPadding: number;
  filterTopPadding: number;
  selectionAccentHex: string;
  toolbarDividerColor: string;
  showFilter?: boolean;
  filterPanelRef?: React.RefObject<HTMLDivElement>;
  onReload?: () => void;
  onToggleFilter?: () => void;
  canModifyData: boolean;
  selectedRowKeysLength: number;
  deleteTargetRowCount: number;
  allSelectedAreDeleted: boolean;
  cellEditMode: boolean;
  selectedCellsSize: number;
  copiedCellPatchColumnCount: number;
  hasChanges: boolean;
  pendingChangeCount: number;
  dataEditCommitMode: 'manual' | 'auto';
  dataEditAutoCommitDelayMs: number;
  dataEditAutoCommitDelayOptions: Array<{ value: number; label: string }>;
  autoCommitRemainingSeconds: number | null;
  canImport: boolean;
  canExport: boolean;
  isQueryResultExport: boolean;
  canCopyQueryResult: boolean;
  prefersManualTotalCount: boolean;
  aiShortcutLabel: string;
  legacyAiButtonStyle?: React.CSSProperties;
  paginationTotalCountLoading?: boolean;
  toolbarExtraActions?: React.ReactNode;
  filterConditions: GridFilterCondition[];
  sortInfo: GridSortInfo[];
  displayColumnNames: string[];
  quickWhereDraft: string;
  quickWhereCondition?: string;
  quickWhereSuggestionsOpen: boolean;
  quickWhereSuggestionOptions: Array<{ value: string; label?: React.ReactNode; insertText?: string }>;
  gridFieldSelectOptions: Array<{ value: string; label: string; title: string }>;
  filterLogicOptions: Array<{ value: string; label: string }>;
  filterOpOptions: Array<{ value: string; label: string }>;
  renderGridFieldSelectOption: (option: { label?: React.ReactNode; value?: unknown; title?: unknown }) => React.ReactNode;
  noAutoCapInputProps: Record<string, unknown>;
  filterFieldSelectStyle: React.CSSProperties;
  filterFieldPopupWidth: number;
  onOpenExportModal: () => void;
  queryResultCopyMenu: MenuProps['items'];
  dbType: string;
  onResetPendingChanges: () => void;
  onDataEditCommitModeChange: (mode: 'manual' | 'auto') => void;
  onDataEditAutoCommitDelayChange: (delayMs: number) => void;
  onRefresh: () => void;
  onToggleFilterClick: () => void;
  onAddRow: () => void;
  onUndoDeleteSelected: () => void;
  onDeleteSelected: () => void;
  onToggleCellEditMode: () => void;
  onCopySelectedCellsToClipboard: () => void;
  onCopySelectedColumnsFromRow: () => void;
  onOpenBatchEditModal: () => void;
  onPasteCopiedColumnsToSelectedRows: () => void;
  onCommit: () => void;
  onPreviewChanges: () => void;
  onImport: () => void;
  onCopyQueryResultCsv: () => void;
  onRequestAiInsight: () => void;
  onToggleTotalCount: () => void;
  onQuickWhereDraftChange: (value: string) => void;
  onQuickWhereSuggestionsOpenChange: (open: boolean) => void;
  onQuickWhereKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onQuickWhereSelect: (value: string, option: unknown) => void;
  onQuickWhereCopy: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onQuickWhereCut: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onQuickWherePaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onApplyQuickWhere: () => void;
  onClearQuickWhere: () => void;
  updateFilter: (id: number, field: keyof GridFilterCondition, value: string | boolean) => void;
  removeFilter: (id: number) => void;
  addFilter: () => void;
  isListOp: (op: string) => boolean;
  isBetweenOp: (op: string) => boolean;
  isNoValueOp: (op: string) => boolean;
  enableSortControls: boolean;
  onApplySortInfo: (next: GridSortInfo[]) => void;
  onApplyFilters: () => void;
  onEnableAllFilters: () => void;
  onDisableAllFilters: () => void;
  onClearFiltersAndSorts: () => void;
}

const DataGridToolbarFrame: React.FC<DataGridToolbarFrameProps> = ({
  isV2Ui,
  tableName,
  dbName,
  translate: translateProp,
  loading,
  darkMode,
  bgFilter,
  panelFrameColor,
  panelRadius,
  panelOuterGap,
  panelPaddingY,
  panelPaddingX,
  toolbarBottomPadding,
  filterTopPadding,
  selectionAccentHex,
  toolbarDividerColor,
  showFilter,
  filterPanelRef,
  onReload,
  onToggleFilter,
  canModifyData,
  selectedRowKeysLength,
  deleteTargetRowCount,
  allSelectedAreDeleted,
  cellEditMode,
  selectedCellsSize,
  copiedCellPatchColumnCount,
  hasChanges,
  pendingChangeCount,
  dataEditCommitMode,
  dataEditAutoCommitDelayMs,
  dataEditAutoCommitDelayOptions,
  autoCommitRemainingSeconds,
  canImport,
  canExport,
  isQueryResultExport,
  canCopyQueryResult,
  prefersManualTotalCount,
  aiShortcutLabel,
  legacyAiButtonStyle,
  paginationTotalCountLoading,
  toolbarExtraActions,
  filterConditions,
  sortInfo,
  displayColumnNames,
  quickWhereDraft,
  quickWhereCondition,
  quickWhereSuggestionsOpen,
  quickWhereSuggestionOptions,
  gridFieldSelectOptions,
  filterLogicOptions,
  filterOpOptions,
  renderGridFieldSelectOption,
  noAutoCapInputProps,
  filterFieldSelectStyle,
  filterFieldPopupWidth,
  onOpenExportModal,
  queryResultCopyMenu,
  dbType,
  onResetPendingChanges,
  onDataEditCommitModeChange,
  onDataEditAutoCommitDelayChange,
  onRefresh,
  onToggleFilterClick,
  onAddRow,
  onUndoDeleteSelected,
  onDeleteSelected,
  onToggleCellEditMode,
  onCopySelectedCellsToClipboard,
  onCopySelectedColumnsFromRow,
  onOpenBatchEditModal,
  onPasteCopiedColumnsToSelectedRows,
  onCommit,
  onPreviewChanges,
  onImport,
  onCopyQueryResultCsv,
  onRequestAiInsight,
  onToggleTotalCount,
  onQuickWhereDraftChange,
  onQuickWhereSuggestionsOpenChange,
  onQuickWhereKeyDown,
  onQuickWhereSelect,
  onQuickWhereCopy,
  onQuickWhereCut,
  onQuickWherePaste,
  onApplyQuickWhere,
  onClearQuickWhere,
  updateFilter,
  removeFilter,
  addFilter,
  isListOp,
  isBetweenOp,
  isNoValueOp,
  enableSortControls,
  onApplySortInfo,
  onApplyFilters,
  onEnableAllFilters,
  onDisableAllFilters,
  onClearFiltersAndSorts,
}) => {
  const translate = React.useCallback(
    (key: string, params?: Record<string, string | number>) => translateProp?.(key, params) ?? key,
    [translateProp],
  );
  const renderToolbarDivider = () => (
    <div
      className={isV2Ui ? 'gn-v2-toolbar-divider' : undefined}
      style={isV2Ui ? undefined : { width: 1, height: 18, background: toolbarDividerColor, margin: '0 2px', flexShrink: 0 }}
      aria-hidden="true"
    />
  );

  const quickWherePlaceholder = dbType === 'mongodb'
    ? translate('data_grid.filter.mongodb_query_placeholder')
    : translate('data_grid.filter.quick_where_placeholder');
  const toolbarTitle = tableName || translate('data_grid.table_fallback.query_result');

  return (
    <div
      className={isV2Ui ? 'gn-v2-data-grid-toolbar-frame' : undefined}
      style={{
        margin: `${panelOuterGap}px 0 ${panelOuterGap}px 0`,
        border: `1px solid ${panelFrameColor}`,
        borderRadius: `${panelRadius}px`,
        background: bgFilter,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="data-grid-toolbar-scroll"
        data-grid-primary-actions="true"
        style={{
          padding: showFilter ? `${panelPaddingY}px ${panelPaddingX}px ${toolbarBottomPadding}px ${panelPaddingX}px` : `${panelPaddingY}px ${panelPaddingX}px`,
          border: 'none',
          borderRadius: 0,
          background: 'transparent',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'nowrap',
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarGutter: 'stable',
          WebkitOverflowScrolling: 'touch',
          boxSizing: 'border-box',
        }}
      >
        {isV2Ui && (
          <>
            <div className="gn-v2-data-grid-toolbar-title">
              <TableOutlined className="gn-v2-data-grid-icon" />
              <strong title={toolbarTitle}>{toolbarTitle}</strong>
              {dbName && <small title={dbName}>· {dbName}</small>}
            </div>
            {renderToolbarDivider()}
          </>
        )}
        {onReload && (
          <Button icon={<ReloadOutlined />} disabled={loading} onClick={onRefresh}>
            {translate('data_grid.toolbar.refresh')}
          </Button>
        )}

        {onToggleFilter && (
          <>
            {renderToolbarDivider()}
            <Button icon={<FilterOutlined />} type={showFilter ? 'primary' : 'default'} onClick={onToggleFilterClick}>
              {translate('data_grid.toolbar.filter')}
            </Button>
          </>
        )}

        {canModifyData && (
          <>
            {renderToolbarDivider()}
            <Button icon={<PlusOutlined />} onClick={onAddRow}>{translate('data_grid.toolbar.add_row')}</Button>
            {allSelectedAreDeleted ? (
              <Button icon={<UndoOutlined />} disabled={deleteTargetRowCount === 0} onClick={onUndoDeleteSelected}>{translate('data_grid.toolbar.undo_delete')}</Button>
            ) : (
              <Button icon={<DeleteOutlined />} danger disabled={deleteTargetRowCount === 0} onClick={onDeleteSelected}>{translate('data_grid.toolbar.delete_selected')}</Button>
            )}
            {deleteTargetRowCount > 0 && <span style={{ fontSize: '12px', color: '#888' }}>{translate('data_grid.toolbar.selected_count', { count: deleteTargetRowCount })}</span>}
            {renderToolbarDivider()}
            <Button
              data-grid-cell-editor-action="true"
              icon={<EditOutlined />}
              type={cellEditMode ? 'primary' : 'default'}
              onClick={onToggleCellEditMode}
            >
              {translate('data_grid.toolbar.cell_editor')}
            </Button>
            {cellEditMode && selectedCellsSize > 0 && (
              <>
                <Button icon={<CopyOutlined />} onClick={onCopySelectedCellsToClipboard}>
                  {translate('data_grid.toolbar.copy_selection', { count: selectedCellsSize })}
                </Button>
                <Button icon={<CopyOutlined />} onClick={onCopySelectedColumnsFromRow}>
                  {translate('data_grid.toolbar.copy_selection_columns', { count: selectedCellsSize })}
                </Button>
                <Button type="primary" onClick={onOpenBatchEditModal}>
                  {translate('data_grid.toolbar.batch_fill', { count: selectedCellsSize })}
                </Button>
              </>
            )}
            {cellEditMode && copiedCellPatchColumnCount > 0 && (
              <>
                <Button
                  icon={<VerticalAlignBottomOutlined />}
                  disabled={selectedRowKeysLength === 0}
                  onClick={onPasteCopiedColumnsToSelectedRows}
                >
                  {translate('data_grid.toolbar.paste_to_selected_rows', { count: selectedRowKeysLength })}
                </Button>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {translate('data_grid.toolbar.copied_columns_count', { count: copiedCellPatchColumnCount })}
                </span>
              </>
            )}
            {renderToolbarDivider()}
            <Button
              className={isV2Ui ? 'gn-v2-commit-button' : undefined}
              icon={<SaveOutlined />}
              type="primary"
              disabled={!hasChanges}
              onClick={onCommit}
            >
              {isV2Ui ? (
                <>
                  <span>{translate('data_grid.toolbar.commit_label')}</span>
                  <span className="gn-v2-toolbar-kbd">{pendingChangeCount}</span>
                </>
              ) : translate('data_grid.toolbar.commit', { count: pendingChangeCount })}
            </Button>
            {hasChanges && (
              <Dropdown menu={{ items: [{ key: 'preview-sql', label: translate('data_grid.toolbar.preview_sql_generate'), icon: <ConsoleSqlOutlined />, onClick: onPreviewChanges }] }}>
                <Button icon={<ConsoleSqlOutlined />}>{translate('data_grid.toolbar.preview_sql')} <DownOutlined /></Button>
              </Dropdown>
            )}
            {hasChanges && <Button icon={<UndoOutlined />} onClick={onResetPendingChanges}>{translate('data_grid.toolbar.rollback')}</Button>}
            <Tooltip title={translate('data_grid.toolbar.commit_mode.tooltip')}>
              <Select
                size="small"
                value={dataEditCommitMode}
                onChange={onDataEditCommitModeChange}
                style={{ width: 118, flex: '0 0 auto' }}
                options={[
                  { value: 'manual', label: translate('data_grid.toolbar.commit_mode.manual') },
                  { value: 'auto', label: translate('data_grid.toolbar.commit_mode.auto') },
                ]}
              />
            </Tooltip>
            {dataEditCommitMode === 'auto' && (
              <Select
                size="small"
                value={dataEditAutoCommitDelayMs}
                onChange={onDataEditAutoCommitDelayChange}
                style={{ width: 82, flex: '0 0 auto' }}
                options={dataEditAutoCommitDelayOptions}
              />
            )}
            {dataEditCommitMode === 'auto' && hasChanges && autoCommitRemainingSeconds !== null && (
              <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>
                {translate('data_grid.toolbar.commit_mode.auto_countdown', { seconds: autoCommitRemainingSeconds })}
              </span>
            )}
          </>
        )}

        {(canImport || canExport) && (
          <>
            {renderToolbarDivider()}
            {canImport && <Button icon={<ImportOutlined />} onClick={onImport}>{translate('data_grid.toolbar.import')}</Button>}
            {canExport && <Button icon={<ExportOutlined />} onClick={onOpenExportModal}>{translate('data_grid.toolbar.export')}</Button>}
          </>
        )}

        {isQueryResultExport && (
          <>
            {renderToolbarDivider()}
            <Dropdown menu={{ items: queryResultCopyMenu }} disabled={!canCopyQueryResult}>
              <Button
                data-grid-query-copy-action="true"
                icon={<CopyOutlined />}
                disabled={!canCopyQueryResult}
                onClick={onCopyQueryResultCsv}
              >
                {translate('data_grid.toolbar.copy')} <DownOutlined />
              </Button>
            </Dropdown>
          </>
        )}

        {!canModifyData && selectedCellsSize > 0 && (
          <>
            {renderToolbarDivider()}
            <Button
              data-grid-copy-selection-action="true"
              icon={<CopyOutlined />}
              onClick={onCopySelectedCellsToClipboard}
            >
              {translate('data_grid.toolbar.copy_selection', { count: selectedCellsSize })}
            </Button>
          </>
        )}

        <>
          {renderToolbarDivider()}
          <Tooltip title={translate('data_grid.toolbar.ai_insight_tooltip')}>
            <Button
              className={isV2Ui ? 'gn-v2-ai-insight-button' : undefined}
              icon={<RobotOutlined />}
              style={legacyAiButtonStyle}
              onMouseEnter={(event) => {
                if (isV2Ui) return;
                event.currentTarget.style.background = darkMode ? 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(16,185,129,0.1))' : 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))';
                event.currentTarget.style.borderColor = '#10b981';
              }}
              onMouseLeave={(event) => {
                if (isV2Ui) return;
                event.currentTarget.style.background = darkMode ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))' : 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))';
                event.currentTarget.style.borderColor = darkMode ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.4)';
              }}
              onClick={onRequestAiInsight}
            >
              <span>{isV2Ui ? translate('data_grid.toolbar.ai_insight_short') : translate('data_grid.toolbar.ai_insight')}</span>
              {isV2Ui && aiShortcutLabel !== '-' && <span className="gn-v2-toolbar-kbd">{aiShortcutLabel}</span>}
            </Button>
          </Tooltip>
        </>

        {toolbarExtraActions && (
          <>
            {renderToolbarDivider()}
            {toolbarExtraActions}
          </>
        )}

        {prefersManualTotalCount && (
          <>
            {renderToolbarDivider()}
            <Tooltip title={paginationTotalCountLoading ? translate('data_grid.toolbar.cancel_count_tooltip') : translate('data_grid.toolbar.count_total_tooltip')}>
              <Button
                icon={paginationTotalCountLoading ? <CloseOutlined /> : <VerticalAlignBottomOutlined />}
                onClick={onToggleTotalCount}
              >
                {paginationTotalCountLoading ? translate('data_grid.toolbar.cancel_count') : translate('data_grid.toolbar.count_total')}
              </Button>
            </Tooltip>
          </>
        )}

        <div style={{ marginLeft: 'auto' }} />
      </div>

      {showFilter && (
        <div
          ref={filterPanelRef}
          className={isV2Ui ? 'gn-v2-smart-filter-panel' : undefined}
          style={{
            padding: `${filterTopPadding}px ${panelPaddingX}px ${panelPaddingY}px ${panelPaddingX}px`,
            background: 'transparent',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            data-grid-quick-where="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              marginBottom: 10,
              borderRadius: Math.max(10, panelRadius - 2),
              border: `1px solid ${panelFrameColor}`,
              background: darkMode ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.72)',
              boxSizing: 'border-box',
              minWidth: 0,
            }}
          >
            <span
              style={{
                flex: '0 0 auto',
                minWidth: 58,
                height: 28,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                background: darkMode ? 'rgba(24,144,255,0.18)' : 'rgba(24,144,255,0.10)',
                border: `1px solid ${darkMode ? 'rgba(24,144,255,0.32)' : 'rgba(24,144,255,0.22)'}`,
                color: selectionAccentHex,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.03em',
              }}
            >
              WHERE
            </span>
            <AutoComplete
              value={quickWhereDraft}
              options={quickWhereSuggestionOptions}
              onChange={onQuickWhereDraftChange}
              onOpenChange={onQuickWhereSuggestionsOpenChange}
              onInputKeyDown={onQuickWhereKeyDown}
              onSelect={onQuickWhereSelect}
              style={{ flex: '1 1 320px', minWidth: 220 }}
              popupMatchSelectWidth={420}
            >
              <Input
                {...noAutoCapInputProps}
                allowClear
                data-grid-quick-where-input="true"
                onCopy={onQuickWhereCopy}
                onCut={onQuickWhereCut}
                onPaste={onQuickWherePaste}
                placeholder={quickWherePlaceholder}
              />
            </AutoComplete>
            <Button size="small" type="primary" onClick={onApplyQuickWhere}>
              {translate('data_grid.filter.apply_where')}
            </Button>
            <Button size="small" onClick={onClearQuickWhere} disabled={!quickWhereDraft && !quickWhereCondition}>
              {translate('data_grid.filter.clear')}
            </Button>
          </div>

          <div style={{ maxHeight: 200, overflowY: 'auto', overflowX: 'hidden', flex: '0 1 auto' }}>
            {filterConditions.map((cond, condIndex) => (
              <div key={cond.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start', opacity: cond.enabled === false ? 0.58 : 1 }}>
                <Checkbox
                  checked={cond.enabled !== false}
                  onChange={(event) => updateFilter(cond.id, 'enabled', event.target.checked)}
                  style={{ marginTop: 6, flex: '0 0 auto', whiteSpace: 'nowrap' }}
                >
                  {translate('data_grid.filter.enabled')}
                </Checkbox>
                <Select
                  style={{ width: 96, minWidth: 96, maxWidth: 96, flex: '0 0 96px' }}
                  value={condIndex === 0 ? '__FIRST__' : (cond.logic === 'OR' ? 'OR' : 'AND')}
                  onChange={(value) => updateFilter(cond.id, 'logic', value)}
                  options={condIndex === 0 ? [{ value: '__FIRST__', label: translate('data_grid.filter.first_condition') }] : filterLogicOptions}
                  disabled={condIndex === 0}
                />
                <Select
                  style={filterFieldSelectStyle}
                  value={cond.column}
                  onChange={(value) => updateFilter(cond.id, 'column', value)}
                  options={gridFieldSelectOptions}
                  showSearch
                  optionFilterProp="label"
                  optionRender={renderGridFieldSelectOption}
                  popupMatchSelectWidth={filterFieldPopupWidth}
                  filterOption={(input, option) =>
                    String(option?.label ?? '')
                      .toLowerCase()
                      .includes(String(input || '').trim().toLowerCase())
                  }
                  placeholder={translate('data_grid.filter.search_field_placeholder')}
                  disabled={cond.op === 'CUSTOM'}
                />
                <Select
                  style={{ width: 140 }}
                  value={cond.op}
                  onChange={(value) => updateFilter(cond.id, 'op', value)}
                  options={filterOpOptions}
                />

                {cond.op === 'CUSTOM' ? (
                  <Input.TextArea
                    {...noAutoCapInputProps}
                    style={{ flex: 1 }}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    value={cond.value}
                    onChange={(event) => updateFilter(cond.id, 'value', event.target.value)}
                    placeholder={translate('data_grid.filter.custom_where_placeholder')}
                  />
                ) : isListOp(cond.op) ? (
                  <Input.TextArea
                    {...noAutoCapInputProps}
                    style={{ flex: 1 }}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    value={cond.value}
                    onChange={(event) => updateFilter(cond.id, 'value', event.target.value)}
                    placeholder={translate('data_grid.filter.list_values_placeholder')}
                  />
                ) : isBetweenOp(cond.op) ? (
                  <>
                    <Input
                      {...noAutoCapInputProps}
                      style={{ width: 220 }}
                      value={cond.value}
                      onChange={(event) => updateFilter(cond.id, 'value', event.target.value)}
                      placeholder={translate('data_grid.filter.start_value_placeholder')}
                    />
                    <Input
                      {...noAutoCapInputProps}
                      style={{ width: 220 }}
                      value={cond.value2 || ''}
                      onChange={(event) => updateFilter(cond.id, 'value2', event.target.value)}
                      placeholder={translate('data_grid.filter.end_value_placeholder')}
                    />
                  </>
                ) : isNoValueOp(cond.op) ? (
                  <Input {...noAutoCapInputProps} style={{ width: 220 }} value="" disabled placeholder={translate('data_grid.filter.no_value_placeholder')} />
                ) : (
                  <Input
                    {...noAutoCapInputProps}
                    style={{ width: 280 }}
                    value={cond.value}
                    onChange={(event) => updateFilter(cond.id, 'value', event.target.value)}
                  />
                )}

                <Button icon={<CloseOutlined />} onClick={() => removeFilter(cond.id)} type="text" danger />
              </div>
            ))}
            {enableSortControls && (
              <div style={{ paddingTop: filterConditions.length > 0 ? 4 : 0, borderTop: filterConditions.length > 0 && sortInfo.length > 0 ? `1px dashed ${panelFrameColor}` : 'none' }}>
                {sortInfo.map((item, index) => (
                <div key={`${item.columnKey || 'sort'}-${index}`} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', opacity: item.enabled === false ? 0.58 : 1 }}>
                  <Checkbox
                    checked={item.enabled !== false}
                    onChange={(event) => {
                      const next = [...sortInfo];
                      next[index] = { ...next[index], enabled: event.target.checked };
                      onApplySortInfo(next);
                    }}
                    style={{ flex: '0 0 auto' }}
                  />
                  <span style={{ fontSize: 12, color: 'inherit', opacity: 0.7, whiteSpace: 'nowrap', minWidth: 32 }}>
                    {index === 0 ? translate('data_grid.filter.sort_label') : translate('data_grid.filter.then_label')}
                  </span>
                  <Select
                    style={filterFieldSelectStyle}
                    value={item.columnKey || undefined}
                    onChange={(value) => {
                      const next = [...sortInfo];
                      if (!value) {
                        next.splice(index, 1);
                      } else {
                        next[index] = { ...next[index], columnKey: value };
                      }
                      onApplySortInfo(next.filter((entry) => entry.columnKey));
                    }}
                    options={displayColumnNames
                      .filter((columnName) => columnName === item.columnKey || !sortInfo.some((entry) => entry.columnKey === columnName))
                      .map((columnName) => ({ value: columnName, label: columnName, title: columnName }))}
                    showSearch
                    optionFilterProp="label"
                    optionRender={renderGridFieldSelectOption}
                    popupMatchSelectWidth={filterFieldPopupWidth}
                    filterOption={(input, option) =>
                      String(option?.label ?? '')
                        .toLowerCase()
                        .includes(String(input || '').trim().toLowerCase())
                    }
                    placeholder={translate('data_grid.filter.select_sort_field_placeholder')}
                    allowClear
                    onClear={() => {
                      const next = sortInfo.filter((_, itemIndex) => itemIndex !== index);
                      onApplySortInfo(next);
                    }}
                  />
                  <Select
                    style={{ width: 110 }}
                    value={item.order || 'ascend'}
                    onChange={(value) => {
                      const next = [...sortInfo];
                      next[index] = { ...next[index], order: value };
                      onApplySortInfo(next);
                    }}
                    options={[
                      { value: 'ascend', label: `${translate('data_grid.filter.sort_asc')} ↑` },
                      { value: 'descend', label: `${translate('data_grid.filter.sort_desc')} ↓` },
                    ]}
                    disabled={!item.columnKey}
                  />
                  <Button
                    icon={<CloseOutlined />}
                    type="text"
                    danger
                    size="small"
                    onClick={() => onApplySortInfo(sortInfo.filter((_, itemIndex) => itemIndex !== index))}
                  />
                </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              flex: '0 0 auto',
              marginTop: ((enableSortControls && sortInfo.length > 0) || filterConditions.length > 0) ? 4 : 0,
              paddingTop: ((enableSortControls && sortInfo.length > 0) || filterConditions.length > 0) ? 6 : 0,
              borderTop: ((enableSortControls && sortInfo.length > 0) || filterConditions.length > 0) ? `1px dashed ${panelFrameColor}` : 'none',
            }}
          >
            <Button type="primary" ghost onClick={addFilter} size="small" icon={<PlusOutlined />}>{translate('data_grid.filter.add_condition')}</Button>
            {enableSortControls && (
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  const nextColumn = displayColumnNames.find((columnName) => !sortInfo.some((item) => item.columnKey === columnName)) || displayColumnNames[0] || '';
                  onApplySortInfo([...sortInfo, { columnKey: nextColumn, order: 'ascend', enabled: true }]);
                }}
                disabled={sortInfo.length >= displayColumnNames.length}
              >
                {translate('data_grid.filter.add_sort')}
              </Button>
            )}
            <div style={{ width: 1, height: 16, background: panelFrameColor, margin: '0 2px', flexShrink: 0 }} />
            <Button size="small" onClick={onEnableAllFilters}>{translate('data_grid.filter.enable_all')}</Button>
            <Button size="small" onClick={onDisableAllFilters}>{translate('data_grid.filter.disable_all')}</Button>
            <div style={{ width: 1, height: 16, background: panelFrameColor, margin: '0 2px', flexShrink: 0 }} />
            <Button type="primary" onClick={onApplyFilters} size="small">{translate('data_grid.filter.apply')}</Button>
            <Button size="small" icon={<ClearOutlined />} onClick={onClearFiltersAndSorts}>{translate('data_grid.filter.clear')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataGridToolbarFrame;
