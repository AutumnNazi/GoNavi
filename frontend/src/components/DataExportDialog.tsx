import Modal from './common/ResizableDraggableModal';
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Select, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { t } from '../i18n';

export * from './dataExportOptions';
import {
  type DataExportDialogValues, type DataExportFormat, type DataExportScopeOption,
  type ShowDataExportDialogOptions, normalizeDataExportDialogValues,
  resolveDataExportColumns, resolveDataExportFormatOptions, resolveDataExportFileOptions,
  validateDataExportDialogValues,
} from './dataExportOptions';
import DataExportFormatFields from './DataExportFormatFields';

export type DataExportColumnSelectProps = {
  availableColumns: string[];
  value: string[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (columns: string[]) => void;
};

export const DataExportColumnSelect: React.FC<DataExportColumnSelectProps> = ({
  availableColumns,
  value,
  disabled = false,
  loading = false,
  onChange,
}) => {
  const normalizedColumns = useMemo(
    () => resolveDataExportColumns(undefined, availableColumns) || [],
    [availableColumns],
  );
  const selectedColumns = useMemo(() => {
    const seen = new Set<string>();
    return value
      .map((column) => String(column ?? ''))
      .filter((column) => {
        if (!column.trim() || seen.has(column)) return false;
        seen.add(column);
        return true;
      });
  }, [value]);
  const selectedColumnSet = useMemo(() => new Set(selectedColumns), [selectedColumns]);
  const totalColumns = useMemo(
    () => new Set([...normalizedColumns, ...selectedColumns]).size,
    [normalizedColumns, selectedColumns],
  );
  const allSelected = normalizedColumns.length > 0
    && normalizedColumns.every((column) => selectedColumnSet.has(column));

  return (
    <div data-export-column-selector="true">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: 28,
          marginBottom: 4,
        }}
      >
        <span
          data-export-column-selection-count="true"
          aria-live="polite"
          style={{ color: 'var(--ant-color-text-secondary, rgba(0,0,0,0.45))', fontSize: 12 }}
        >
          {t('data_export.dialog.field.columns_selected', {
            selected: selectedColumns.length,
            total: totalColumns,
          })}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type="text"
            size="small"
            data-export-columns-select-all="true"
            disabled={disabled || loading || normalizedColumns.length === 0 || allSelected}
            onClick={() => onChange(normalizedColumns)}
          >
            {t('data_export.action.select_all')}
          </Button>
          <Button
            type="text"
            size="small"
            data-export-columns-clear="true"
            disabled={disabled || loading || selectedColumns.length === 0}
            onClick={() => onChange([])}
          >
            {t('data_export.action.clear')}
          </Button>
        </div>
      </div>
      <Select
        aria-label={t('data_export.dialog.field.columns')}
        style={{ width: '100%' }}
        mode="multiple"
        value={selectedColumns}
        loading={loading}
        disabled={disabled}
        options={normalizedColumns.map((column) => ({ value: column, label: column }))}
        placeholder={t('data_export.dialog.field.columns_placeholder')}
        showSearch
        optionFilterProp="label"
        maxTagCount="responsive"
        onChange={(columns) => onChange(resolveDataExportColumns(columns, normalizedColumns) || [])}
      />
    </div>
  );
};

const DataExportDialogContent: React.FC<{
  scopeOptions: DataExportScopeOption[];
  availableColumns?: string[];
  initialValues?: Partial<DataExportDialogValues>;
  allowInsertSql?: boolean;
  allowColumnCommentHeaders?: boolean;
  onChange: (values: DataExportDialogValues) => void;
}> = ({ scopeOptions, availableColumns, initialValues, allowInsertSql = false, allowColumnCommentHeaders = false, onChange }) => {
  const [values, setValues] = useState<DataExportDialogValues>(() => normalizeDataExportDialogValues(
    scopeOptions,
    initialValues,
    allowInsertSql,
    availableColumns,
  ));
  const formatOptions = useMemo(() => resolveDataExportFormatOptions(allowInsertSql), [allowInsertSql]);
  useEffect(() => {
    onChange(values);
  }, [onChange, values]);

  const selectedScope = useMemo(
    () => scopeOptions.find((item) => String(item.value) === String(values.scope)),
    [scopeOptions, values.scope],
  );

  return (
    <div data-export-config-modal="true">
      <Form layout="vertical" colon={false}>
        <Form.Item label={t('data_export.dialog.field.format')} style={{ marginBottom: 16 }}>
          <Select
            value={values.format}
            options={formatOptions}
            onChange={(format) => setValues((prev) => ({ ...prev, format: format as DataExportFormat }))}
          />
        </Form.Item>

        <Form.Item label={t('data_export.dialog.field.scope')} style={{ marginBottom: 8 }}>
          <Select
            value={values.scope}
            disabled={scopeOptions.length <= 1}
            options={scopeOptions.map((item) => ({
              value: item.value,
              label: item.label,
              disabled: item.disabled,
            }))}
            onChange={(scope) => setValues((prev) => ({ ...prev, scope }))}
          />
        </Form.Item>

        {selectedScope?.description && (
          <div style={{ marginBottom: 16, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
            {selectedScope.description}
          </div>
        )}

        {Array.isArray(availableColumns) && (
          <Form.Item
            label={t('data_export.dialog.field.columns')}
            extra={t('data_export.dialog.field.columns_help')}
            style={{ marginBottom: 16 }}
          >
            <DataExportColumnSelect
              availableColumns={availableColumns}
              value={values.columns || []}
              onChange={(columns) => setValues((prev) => ({
                ...prev,
                columns: resolveDataExportColumns(columns, availableColumns) || [],
              }))}
            />
          </Form.Item>
        )}

        <DataExportFormatFields
          values={values}
          onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          allowColumnCommentHeaders={allowColumnCommentHeaders}
        />
      </Form>
    </div>
  );
};

export async function showDataExportDialog(
  modal: ReturnType<typeof Modal.useModal>[0],
  options: ShowDataExportDialogOptions,
): Promise<DataExportDialogValues | null> {
  const allowInsertSql = options.allowInsertSql === true;
  const initialValues = normalizeDataExportDialogValues(
    options.scopeOptions,
    options.initialValues,
    allowInsertSql,
    options.availableColumns,
  );

  return new Promise((resolve) => {
    let resolved = false;
    let latestValues = initialValues;

    const finish = (nextValue: DataExportDialogValues | null) => {
      if (resolved) return;
      resolved = true;
      resolve(nextValue);
    };

    modal.confirm({
      title: options.title,
      icon: <ExportOutlined />,
      width: 520,
      centered: true,
      maskClosable: true,
      okText: options.okText || t('data_export.dialog.action.start'),
      cancelText: t('common.cancel'),
      content: (
        <DataExportDialogContent
          scopeOptions={options.scopeOptions}
          availableColumns={options.availableColumns}
          initialValues={initialValues}
          allowInsertSql={allowInsertSql}
          allowColumnCommentHeaders={options.allowColumnCommentHeaders}
          onChange={(values) => {
            latestValues = values;
          }}
        />
      ),
      onOk: async () => {
        const errorMessage = validateDataExportDialogValues(
          latestValues,
          options.scopeOptions,
          allowInsertSql,
          options.availableColumns,
        );
        if (errorMessage) {
          void message.error(errorMessage);
          throw new Error(errorMessage);
        }
        finish(resolveDataExportFileOptions(latestValues));
      },
      onCancel: () => {
        finish(null);
      },
    });
  });
}
