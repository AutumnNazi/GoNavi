import React, { useCallback, useEffect, useState } from 'react';
import { Input, Radio, Select, Space, Spin, message } from 'antd';
import Modal from './common/ResizableDraggableModal';
import { t, type I18nParams } from '../i18n';
import { noAutoCapInputProps } from '../utils/inputAutoCap';
import type { RpcConnectionConfig } from '../utils/connectionRpcConfig';
import type { TableDesignerClipboardColumn } from './tableDesignerColumnClipboard';
import { qualifyTableDesignerCreateName } from './tableDesignerSchemaContext';
import {
  buildCopyColumnsToExistingTablePlan,
  loadCopyTargetTableColumns,
  loadCopyTargetTableNames,
} from './tableDesignerCopyColumnsToTable';
import TableDesignerSqlPreview from './TableDesignerSqlPreview';

export type CopyColumnsTargetMode = 'new' | 'existing';

export type TableDesignerCopyColumnsExecuteResult = {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  rawMessage?: string;
};

type SelectOption = { label: string; value: string };

interface TableDesignerCopyColumnsModalProps {
  open: boolean;
  language: string;
  darkMode: boolean;
  selectedCount: number;
  selectedColumns: TableDesignerClipboardColumn[];
  defaultNewTableName: string;
  currentTableName: string;
  dbName: string;
  dbType: string;
  selectedSchema: string;
  rpcConfig: RpcConnectionConfig | null;
  charset: string;
  collation: string;
  charsetOptions: SelectOption[];
  collationOptions: Record<string, SelectOption[]>;
  showCharsetFields: boolean;
  buildCreateTableSql: (tableName: string, charset: string, collation: string) => string;
  onExecute: (sql: string, target: { tableName: string; kind: 'create' | 'alter' }) => Promise<TableDesignerCopyColumnsExecuteResult>;
  onClose: () => void;
}

const fallbackDetail = (language: string, detail?: string) => (
  String(detail || '').trim() || t('table_designer.fallback.unknown_error', undefined, language)
);

const TableDesignerCopyColumnsModal: React.FC<TableDesignerCopyColumnsModalProps> = ({
  open,
  language,
  darkMode,
  selectedCount,
  selectedColumns,
  defaultNewTableName,
  currentTableName,
  dbName,
  dbType,
  selectedSchema,
  rpcConfig,
  charset,
  collation,
  charsetOptions,
  collationOptions,
  showCharsetFields,
  buildCreateTableSql,
  onExecute,
  onClose,
}) => {
  const translate = useCallback(
    (key: string, params?: I18nParams) => t(key, params, language),
    [language],
  );
  const [mode, setMode] = useState<CopyColumnsTargetMode>('existing');
  const [newTableName, setNewTableName] = useState(defaultNewTableName);
  const [newCharset, setNewCharset] = useState(charset);
  const [newCollation, setNewCollation] = useState(collation);
  const [existingTableName, setExistingTableName] = useState<string>();
  const [tableOptions, setTableOptions] = useState<SelectOption[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState('');
  const [previewSql, setPreviewSql] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [renamedCount, setRenamedCount] = useState(0);
  const [strippedPrimaryKey, setStrippedPrimaryKey] = useState(false);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('existing');
    setNewTableName(defaultNewTableName);
    setNewCharset(charset);
    setNewCollation(collation);
    setExistingTableName(undefined);
    setPreviewSql('');
    setPreviewError('');
    setRenamedCount(0);
    setStrippedPrimaryKey(false);
  }, [charset, collation, defaultNewTableName, open]);

  useEffect(() => {
    if (!open || !rpcConfig) return undefined;
    let cancelled = false;
    setTablesLoading(true);
    setTablesError('');
    void loadCopyTargetTableNames({
      rpcConfig,
      dbName,
      currentTableName,
      dbType,
      selectedSchema,
    }).then((result) => {
      if (cancelled) return;
      setTableOptions(result.tables.map((name) => ({ label: name, value: name })));
      setTablesError(result.error ? translate('table_designer.message.load_target_tables_failed', {
        detail: fallbackDetail(language, result.error),
      }) : '');
      if (result.tables.length === 0 && !result.error) {
        setMode('new');
      }
    }).finally(() => {
      if (!cancelled) setTablesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentTableName, dbName, dbType, language, open, rpcConfig, selectedSchema, translate]);

  useEffect(() => {
    if (!open || mode !== 'existing' || !existingTableName || !rpcConfig) {
      setPreviewSql('');
      setPreviewError('');
      setRenamedCount(0);
      setStrippedPrimaryKey(false);
      return undefined;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    void loadCopyTargetTableColumns({
      rpcConfig,
      dbName,
      tableName: existingTableName,
    }).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setPreviewSql('');
        setPreviewError(translate('table_designer.message.load_target_columns_failed', {
          detail: fallbackDetail(language, result.error),
        }));
        return;
      }
      const plan = buildCopyColumnsToExistingTablePlan({
        dbType,
        tableName: qualifyTableDesignerCreateName(existingTableName, selectedSchema, dbType),
        targetColumns: result.columns,
        copiedColumns: selectedColumns,
        translate,
      });
      setPreviewSql(plan.sql);
      setRenamedCount(plan.renamedCount);
      setStrippedPrimaryKey(plan.strippedPrimaryKey);
      if (!plan.sql.trim()) {
        setPreviewError(translate('table_designer.message.no_changes_detected'));
      }
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dbName, dbType, existingTableName, language, mode, open, rpcConfig, selectedColumns, selectedSchema, translate]);

  const handleCharsetChange = (value: string) => {
    setNewCharset(value);
    const nextOptions = collationOptions[value] || [];
    setNewCollation(nextOptions[0]?.value || newCollation);
  };

  const handleOk = async () => {
    if (selectedColumns.length === 0) {
      message.error(translate('table_designer.message.no_copyable_columns'));
      return;
    }
    if (mode === 'new') {
      const tableName = newTableName.trim();
      if (!tableName) {
        message.error(translate('table_designer.message.target_table_required'));
        return;
      }
      const sql = buildCreateTableSql(tableName, newCharset, newCollation);
      setExecuting(true);
      try {
        const result = await onExecute(sql, { tableName, kind: 'create' });
        if (result.cancelled) return;
        if (result.ok) {
          message.success(translate('table_designer.message.columns_copied_to_new_table', {
            count: selectedCount,
            table: tableName,
          }));
          onClose();
          return;
        }
        message.error(translate('table_designer.message.execution_failed', {
          detail: fallbackDetail(language, result.rawMessage || result.message),
        }));
      } finally {
        setExecuting(false);
      }
      return;
    }

    const tableName = String(existingTableName || '').trim();
    if (!tableName) {
      message.error(translate('table_designer.message.select_target_table'));
      return;
    }
    if (!previewSql.trim()) {
      message.error(previewError || translate('table_designer.message.no_changes_detected'));
      return;
    }
    setExecuting(true);
    try {
      const result = await onExecute(previewSql, { tableName, kind: 'alter' });
      if (result.cancelled) return;
      if (result.ok) {
        message.success(translate('table_designer.message.columns_copied_to_existing_table', {
          count: selectedCount,
          table: tableName,
        }));
        onClose();
        return;
      }
      message.error(translate('table_designer.message.execution_failed', {
        detail: fallbackDetail(language, result.rawMessage || result.message),
      }));
    } finally {
      setExecuting(false);
    }
  };

  const okDisabled = selectedCount === 0 || (mode === 'existing'
    ? !existingTableName || !previewSql.trim() || previewLoading
    : !newTableName.trim());

  return (
    <Modal
      title={translate('table_designer.modal.copy_columns_title')}
      open={open}
      onCancel={onClose}
      onOk={() => { void handleOk(); }}
      okText={mode === 'new'
        ? translate('table_designer.action.create_table')
        : translate('table_designer.action.execute')}
      cancelText={translate('table_designer.action.cancel')}
      confirmLoading={executing}
      okButtonProps={{ disabled: okDisabled }}
      width={640}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div style={{ color: '#666' }}>
          {translate('table_designer.selection.columns_selected', { count: selectedCount })}
        </div>
        <Radio.Group
          value={mode}
          onChange={(event) => setMode(event.target.value as CopyColumnsTargetMode)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: translate('table_designer.copy_columns.mode.existing_table'), value: 'existing' },
            { label: translate('table_designer.copy_columns.mode.new_table'), value: 'new' },
          ]}
        />
        {mode === 'new' ? (
          <>
            <Input
              {...noAutoCapInputProps}
              placeholder={translate('table_designer.placeholder.target_table_name')}
              value={newTableName}
              onChange={(event) => setNewTableName(event.target.value)}
              maxLength={128}
            />
            {showCharsetFields && (
              <Space wrap>
                <Select
                  value={newCharset}
                  onChange={handleCharsetChange}
                  options={charsetOptions}
                  style={{ width: 160 }}
                />
                <Select
                  value={newCollation}
                  onChange={setNewCollation}
                  options={collationOptions[newCharset] || []}
                  style={{ width: 220 }}
                />
              </Space>
            )}
          </>
        ) : (
          <>
            <Select
              showSearch
              allowClear
              loading={tablesLoading}
              value={existingTableName}
              placeholder={translate('table_designer.placeholder.select_target_table')}
              options={tableOptions}
              onChange={(value) => setExistingTableName(value)}
              optionFilterProp="label"
              style={{ width: '100%' }}
              notFoundContent={tablesLoading ? <Spin size="small" /> : translate('table_designer.message.no_target_tables')}
            />
            {tablesError ? <div style={{ color: '#ff4d4f' }}>{tablesError}</div> : null}
            {strippedPrimaryKey ? (
              <div style={{ color: '#888', fontSize: 12 }}>
                {translate('table_designer.copy_columns.pk_stripped_hint')}
              </div>
            ) : null}
            {renamedCount > 0 ? (
              <div style={{ color: '#888', fontSize: 12 }}>
                {translate('table_designer.copy_columns.conflict_hint')}
              </div>
            ) : null}
            {previewLoading ? <Spin size="small" /> : null}
            {previewError ? <div style={{ color: '#ff4d4f' }}>{previewError}</div> : null}
            {previewSql.trim() ? (
              <TableDesignerSqlPreview sql={previewSql} darkMode={darkMode} height="180px" />
            ) : null}
          </>
        )}
      </Space>
    </Modal>
  );
};

export default TableDesignerCopyColumnsModal;
