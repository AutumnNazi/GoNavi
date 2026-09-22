import React from 'react';
import { Button, Input, Modal, Select, Tooltip } from 'antd';
import { CheckOutlined } from '@ant-design/icons';

import { t as defaultTranslate, type I18nParams } from '../../i18n';
import { useOptionalI18n } from '../../i18n/provider';
import {
  QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
  QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
  QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
} from './queryEditorResultBudget';

/**
 * 工具栏「最大返回行数」上限，与 store 的 sanitizeQueryOptions 保持一致
 * （store.ts 中 `Math.min(50000, Math.trunc(maxRows))`）。这里做前置校验，
 * 让超限输入直接报错而不是被静默截断。
 */
export const QUERY_EDITOR_MAX_ROWS_UPPER_BOUND = 50000;

/** 自定义行数输入的校验：仅接受 1–50000 的正整数（与上限契约一致）。 */
export const isValidQueryEditorCustomMaxRows = (value: string): boolean => {
  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) return false;
  const numericValue = Number(normalizedValue);
  return Number.isSafeInteger(numericValue)
    && numericValue > 0
    && numericValue <= QUERY_EDITOR_MAX_ROWS_UPPER_BOUND;
};

/**
 * 选中值不在固定枚举内时补一个同值选项，避免受控 Select 回显空白。
 * 与 DataGrid 的 buildDataGridPaginationPageSizeOptions 同思路。
 */
export const buildQueryEditorMaxRowsOptions = (
  maxRows: number,
  fixedOptions: Array<{ label: React.ReactNode; value: number }>,
): Array<{ label: React.ReactNode; value: number }> => {
  const options = [...fixedOptions];
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) return options;
  if (options.some((option) => option.value === maxRows)) return options;
  return [...options, { label: String(maxRows), value: maxRows }];
};

export interface QueryEditorToolbarMaxRowsSelectProps {
  maxRows: number;
  onMaxRowsChange: (maxRows: number) => void;
  translate?: (key: string, params?: I18nParams) => string;
}

/**
 * 工具栏「最大返回行数」选择器：固定枚举 + 下拉内嵌自定义输入。
 *
 * 交互照搬 DataGridPaginationBar 的自定义页大小实现（受控 open + ref 读值，
 * 规避 antd 受控弹层的时序问题），并补上 `popupMatchSelectWidth={false}`：
 * 该 Select 的 CSS 被锁死 80px 宽，不放开弹层宽度会把内嵌输入区压扁。
 */
const QueryEditorToolbarMaxRowsSelect: React.FC<QueryEditorToolbarMaxRowsSelectProps> = ({
  maxRows,
  onMaxRowsChange,
  translate,
}) => {
  const i18n = useOptionalI18n();
  const t = translate ?? i18n?.t ?? defaultTranslate;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [customInput, setCustomInput] = React.useState('');
  const customInputRef = React.useRef('');
  const [customError, setCustomError] = React.useState(false);
  const safetyParams = {
    rows: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
    size: Math.round(QUERY_EDITOR_SAFE_MAX_RESULT_BYTES / 1024 / 1024),
    fieldSize: Math.round(QUERY_EDITOR_SAFE_MAX_FIELD_BYTES / 1024 / 1024),
  };

  const fixedOptions = React.useMemo(() => [
    { label: '100', value: 100 },
    { label: t('query_editor.max_rows.option_500'), value: 500 },
    { label: t('query_editor.max_rows.option_1000'), value: 1000 },
    { label: t('query_editor.max_rows.option_5000'), value: 5000 },
    { label: t('query_editor.max_rows.option_20000'), value: 20000 },
    {
      label: t('query_editor.max_rows.option_unlimited_safe', {
        rows: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
      }),
      value: 0,
    },
  ], [t]);
  const options = React.useMemo(
    () => buildQueryEditorMaxRowsOptions(maxRows, fixedOptions),
    [fixedOptions, maxRows],
  );

  const handleMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) {
      // 每次展开都以「当前生效的行数」重置输入框，而不是仅在首次展开时预填：
      // 若沿用上次残留的数字，用户用固定选项改过后再展开会看到过期内容，
      // 此时直接点勾/回车会把过期数字写回，静默覆盖掉刚选的固定项。
      // `0` 是「不限」的哨兵值，不能预填进输入框（否则与「至少 1 行」的校验自相矛盾）。
      const initialValue = maxRows > 0 ? String(maxRows) : '';
      customInputRef.current = initialValue;
      setCustomInput(initialValue);
    }
    if (!open) setCustomError(false);
  };

  const submitCustomMaxRows = () => {
    const normalizedValue = customInputRef.current.trim();
    if (!isValidQueryEditorCustomMaxRows(normalizedValue)) {
      setCustomError(true);
      return;
    }
    const nextMaxRows = Number(normalizedValue);
    customInputRef.current = String(nextMaxRows);
    setCustomInput(String(nextMaxRows));
    setMenuOpen(false);
    setCustomError(false);
    onMaxRowsChange(nextMaxRows);
  };

  // 「不限」只取消自动 LIMIT，后端扫描层仍按安全预算截断；把它明确告知用户，
  // 避免被理解成「无任何上限」。
  const handleMaxRowsChange = (nextMaxRows: number) => {
    if (nextMaxRows !== 0) {
      onMaxRowsChange(nextMaxRows);
      return;
    }
    void Modal.confirm({
      title: t('query_editor.max_rows.unlimited_confirm.title'),
      content: t('query_editor.max_rows.unlimited_confirm.content', safetyParams),
      okText: t('query_editor.max_rows.unlimited_confirm.ok'),
      cancelText: t('common.cancel'),
      onOk: () => onMaxRowsChange(0),
    });
  };

  // 惰性构造：弹层未展开时不触碰 antd 的 Input/Button，避免无谓的 JSX 构造。
  const renderCustomMaxRowsDropdown = () => (
    <div
      data-query-editor-max-rows-dropdown="true"
      style={{ width: 128, maxWidth: 'calc(100vw - 24px)' }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <label style={{ display: 'grid', gap: 4, padding: '6px 8px 8px' }}>
        <span>{t('query_editor.max_rows.custom_label')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Input
            size="small"
            value={customInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              customInputRef.current = nextValue;
              setCustomInput(nextValue);
              if (customError) setCustomError(false);
            }}
            onPressEnter={submitCustomMaxRows}
            onMouseDown={(event) => event.stopPropagation()}
            data-query-editor-max-rows-input="true"
            aria-label={t('query_editor.max_rows.custom_label')}
            status={customError ? 'error' : undefined}
            style={{ width: 80, minWidth: 80, maxWidth: 80, flex: '0 0 80px' }}
          />
          <Tooltip title={t('common.confirm')}>
            <Button
              type="text"
              size="small"
              icon={<CheckOutlined />}
              data-query-editor-max-rows-confirm="true"
              aria-label={t('common.confirm')}
              onClick={submitCustomMaxRows}
              // 必须阻止 mousedown 的默认焦点转移：否则内嵌输入框立刻失焦，rc-select
              // 收到 blur 即关闭弹层并播放退场动画，按钮在松开鼠标前被滑走，click 落在
              // body 上，onClick 永不触发（表现为「填了数字点勾没反应」）。
              // 仅 stopPropagation 无效，它拦不住默认行为。
              onMouseDown={(event) => event.preventDefault()}
              style={{ width: 24, minWidth: 24, maxWidth: 24, height: 24, minHeight: 24, flex: '0 0 24px' }}
            />
          </Tooltip>
        </span>
      </label>
      {customError ? (
        <span role="alert" data-query-editor-max-rows-error="true">
          {t('query_editor.max_rows.custom_invalid')}
        </span>
      ) : null}
    </div>
  );

  // Tooltip 必须内联在这里：调用方若在外面套一层 <Tooltip>，rc-trigger 对非
  // forwardRef 的函数组件不会注入 ref，气泡会静默失效（见 QueryEditorToolbarRunAction）。
  return (
    <Tooltip title={t('query_editor.max_rows.tooltip', safetyParams)}>
      <Select
        className="gn-v2-query-toolbar-select gn-v2-query-toolbar-max-rows-select"
        value={maxRows}
        onChange={(value) => handleMaxRowsChange(Number(value))}
        open={menuOpen}
        onOpenChange={handleMenuOpenChange}
        popupRender={(menu) => (
          <>
            {menu}
            {renderCustomMaxRowsDropdown()}
          </>
        )}
        popupMatchSelectWidth={false}
        options={options}
      />
    </Tooltip>
  );
};

export default QueryEditorToolbarMaxRowsSelect;
