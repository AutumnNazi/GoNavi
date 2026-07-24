import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Typography, message } from 'antd';
import { FileAddOutlined, ImportOutlined } from '@ant-design/icons';

import { DBGetDatabases, DBGetTables, ImportData } from '../../wailsjs/go/app/App';
import { useStore } from '../store';
import type { SavedConnection, TabData } from '../types';
import { t as defaultTranslate } from '../i18n';
import { useOptionalI18n } from '../i18n/provider';
import { BACKEND_CANCELLED_MESSAGE } from '../utils/connectionExport';
import { buildRpcConnectionConfig } from '../utils/connectionRpcConfig';
import { isConnectionDataImportRestricted } from '../utils/connectionReadOnly';
import { getDataSourceCapabilities } from '../utils/dataSourceCapabilities';
import { normalizeTableNamesFromMetadataRows } from '../utils/tableMetadataRows';
import ImportPreviewModal from './ImportPreviewModal';
import './DataImportWorkbench.css';

const { Text, Title } = Typography;

type SelectOption = {
  value: string;
  label: React.ReactNode;
  title: string;
};

const normalizeConnectionConfig = (connection: SavedConnection) => ({
  ...connection.config,
  port: Number(connection.config.port),
  password: connection.config.password || '',
  database: connection.config.database || '',
  useSSH: connection.config.useSSH || false,
  ssh: connection.config.ssh || {
    host: '',
    port: 22,
    user: '',
    password: '',
    keyPath: '',
  },
});

const toSortedOptions = (values: string[]): SelectOption[] => (
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
    .map((value) => ({ value, label: value, title: value }))
);

const normalizeDatabaseNames = (rows: unknown): string[] => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => String(row?.Database || row?.database || '').trim())
    .filter(Boolean);
};

const getFileName = (filePath: string): string => {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
};

const isEligibleImportConnection = (connection: SavedConnection): boolean => (
  getDataSourceCapabilities(connection.config).supportsCopyInsert
  && !isConnectionDataImportRestricted(connection.config)
);

const DataImportWorkbench: React.FC<{ tab: TabData }> = ({ tab }) => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;
  const connections = useStore((state) => state.connections);
  const darkMode = useStore((state) => state.theme === 'dark');
  const addTab = useStore((state) => state.addTab);
  const eligibleConnections = useMemo(
    () => connections.filter(isEligibleImportConnection),
    [connections],
  );
  const connectionOptions = useMemo<SelectOption[]>(
    () => eligibleConnections.map((connection) => ({
      value: connection.id,
      label: connection.name,
      title: connection.name,
    })),
    [eligibleConnections],
  );

  const [selectedConnectionId, setSelectedConnectionId] = useState(() => String(tab.connectionId || '').trim());
  const [selectedDbName, setSelectedDbName] = useState(() => String(tab.dbName || '').trim());
  const [selectedTableName, setSelectedTableName] = useState(() => String(tab.tableName || '').trim());
  const [databaseOptions, setDatabaseOptions] = useState<SelectOption[]>([]);
  const [tableOptions, setTableOptions] = useState<SelectOption[]>([]);
  const [filePath, setFilePath] = useState('');
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [selectingFile, setSelectingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [databaseError, setDatabaseError] = useState('');
  const [tableError, setTableError] = useState('');
  const appliedPrefillRef = useRef<string | null>(null);
  const fileSelectionRequestRef = useRef(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const selectedConnection = useMemo(
    () => eligibleConnections.find((connection) => connection.id === selectedConnectionId),
    [eligibleConnections, selectedConnectionId],
  );
  const selectedConnectionConfig = useMemo(
    () => (selectedConnection ? normalizeConnectionConfig(selectedConnection) : null),
    [selectedConnection],
  );
  const targetLocked = Boolean(filePath) || importing;

  const syncWorkbenchTab = useCallback((patch: Partial<TabData>) => {
    addTab({
      ...tabRef.current,
      ...patch,
      id: tabRef.current.id,
      type: 'data-import',
    });
  }, [addTab]);

  useEffect(() => {
    if (importing) return;
    const prefillKey = [tab.connectionId, tab.dbName, tab.tableName]
      .map((value) => String(value || '').trim())
      .join('::');
    if (appliedPrefillRef.current === prefillKey) return;
    appliedPrefillRef.current = prefillKey;
    setSelectedConnectionId(String(tab.connectionId || '').trim());
    setSelectedDbName(String(tab.dbName || '').trim());
    setSelectedTableName(String(tab.tableName || '').trim());
    setFilePath('');
  }, [importing, tab.connectionId, tab.dbName, tab.tableName]);

  useEffect(() => {
    if (importing) return;
    if (connections.length === 0) return;
    if (eligibleConnections.some((connection) => connection.id === selectedConnectionId)) return;
    const nextConnectionId = eligibleConnections[0]?.id || '';
    setSelectedConnectionId(nextConnectionId);
    setSelectedDbName('');
    setSelectedTableName('');
    setFilePath('');
    syncWorkbenchTab({
      connectionId: nextConnectionId,
      dbName: undefined,
      tableName: undefined,
      dataImportRunning: false,
    });
  }, [connections.length, eligibleConnections, importing, selectedConnectionId, syncWorkbenchTab]);

  useEffect(() => {
    if (!selectedConnectionConfig || !selectedConnection) {
      setDatabaseOptions([]);
      setLoadingDatabases(false);
      setDatabaseError('');
      return undefined;
    }

    let alive = true;
    setLoadingDatabases(true);
    setDatabaseError('');
    DBGetDatabases(buildRpcConnectionConfig(selectedConnectionConfig) as any)
      .then((res) => {
        if (!alive) return;
        if (!res.success) {
          setDatabaseOptions([]);
          setSelectedDbName('');
          setSelectedTableName('');
          setTableOptions([]);
          setFilePath('');
          setDatabaseError(t('data_import.workbench.message.load_databases_failed', {
            detail: res.message || '',
          }));
          return;
        }
        let databaseNames = normalizeDatabaseNames(res.data);
        if (selectedConnection.includeDatabases && selectedConnection.includeDatabases.length > 0) {
          const included = new Set(selectedConnection.includeDatabases);
          databaseNames = databaseNames.filter((name) => included.has(name));
        }
        const nextOptions = toSortedOptions(databaseNames);
        setDatabaseOptions(nextOptions);
        const availableNames = new Set(nextOptions.map((option) => option.value));
        setSelectedDbName((current) => {
          if (availableNames.has(current)) return current;
          const configuredDatabase = String(selectedConnection.config.database || '').trim();
          return availableNames.has(configuredDatabase) ? configuredDatabase : '';
        });
      })
      .catch((error: any) => {
        if (!alive) return;
        setDatabaseOptions([]);
        setSelectedDbName('');
        setSelectedTableName('');
        setTableOptions([]);
        setFilePath('');
        setDatabaseError(t('data_import.workbench.message.load_databases_failed', {
          detail: error?.message || String(error),
        }));
      })
      .finally(() => {
        if (alive) setLoadingDatabases(false);
      });

    return () => {
      alive = false;
    };
  }, [selectedConnection, selectedConnectionConfig, t]);

  useEffect(() => {
    if (!selectedConnectionConfig || !selectedDbName) {
      setTableOptions([]);
      setLoadingTables(false);
      setTableError('');
      return undefined;
    }

    let alive = true;
    setLoadingTables(true);
    setTableError('');
    DBGetTables(buildRpcConnectionConfig(selectedConnectionConfig) as any, selectedDbName)
      .then((res) => {
        if (!alive) return;
        if (!res.success) {
          setTableOptions([]);
          setSelectedTableName('');
          setFilePath('');
          setTableError(t('data_import.workbench.message.load_tables_failed', {
            detail: res.message || '',
          }));
          return;
        }
        const nextOptions = toSortedOptions(normalizeTableNamesFromMetadataRows(res.data));
        setTableOptions(nextOptions);
        const availableNames = new Set(nextOptions.map((option) => option.value));
        setSelectedTableName((current) => (availableNames.has(current) ? current : ''));
      })
      .catch((error: any) => {
        if (!alive) return;
        setTableOptions([]);
        setSelectedTableName('');
        setFilePath('');
        setTableError(t('data_import.workbench.message.load_tables_failed', {
          detail: error?.message || String(error),
        }));
      })
      .finally(() => {
        if (alive) setLoadingTables(false);
      });

    return () => {
      alive = false;
    };
  }, [selectedConnectionConfig, selectedDbName, t]);

  const clearSelectedFile = () => {
    fileSelectionRequestRef.current += 1;
    setFilePath('');
  };

  const handleConnectionChange = (connectionId: string) => {
    fileSelectionRequestRef.current += 1;
    setSelectedConnectionId(connectionId);
    setSelectedDbName('');
    setSelectedTableName('');
    setDatabaseOptions([]);
    setTableOptions([]);
    setFilePath('');
    setDatabaseError('');
    setTableError('');
    syncWorkbenchTab({
      connectionId,
      dbName: undefined,
      tableName: undefined,
      dataImportRunning: false,
    });
  };

  const handleDatabaseChange = (dbName: string) => {
    fileSelectionRequestRef.current += 1;
    setSelectedDbName(dbName);
    setSelectedTableName('');
    setTableOptions([]);
    setFilePath('');
    setTableError('');
    syncWorkbenchTab({
      connectionId: selectedConnectionId,
      dbName,
      tableName: undefined,
      dataImportRunning: false,
    });
  };

  const handleTableChange = (tableName: string) => {
    fileSelectionRequestRef.current += 1;
    setSelectedTableName(tableName);
    setFilePath('');
    syncWorkbenchTab({
      connectionId: selectedConnectionId,
      dbName: selectedDbName,
      tableName,
      dataImportRunning: false,
    });
  };

  const handleImportingChange = useCallback((nextImporting: boolean) => {
    setImporting(nextImporting);
    syncWorkbenchTab({
      connectionId: selectedConnectionId,
      dbName: selectedDbName || undefined,
      tableName: selectedTableName || undefined,
      dataImportRunning: nextImporting,
    });
  }, [selectedConnectionId, selectedDbName, selectedTableName, syncWorkbenchTab]);

  const handleSelectFile = async () => {
    if (!selectedConnectionConfig || !selectedDbName || !selectedTableName) return;
    const requestId = fileSelectionRequestRef.current + 1;
    fileSelectionRequestRef.current = requestId;
    setSelectingFile(true);
    try {
      const res = await ImportData(
        buildRpcConnectionConfig(selectedConnectionConfig) as any,
        selectedDbName,
        selectedTableName,
      );
      if (fileSelectionRequestRef.current !== requestId) return;
      const nextFilePath = String(res?.data?.filePath || '').trim();
      if (res.success && nextFilePath) {
        setFilePath(nextFilePath);
        return;
      }
      if (String(res?.message || '').trim() !== BACKEND_CANCELLED_MESSAGE) {
        void message.error(t('data_import.workbench.message.select_file_failed', {
          detail: res?.message || '',
        }));
      }
    } catch (error: any) {
      if (fileSelectionRequestRef.current !== requestId) return;
      void message.error(t('data_import.workbench.message.select_file_failed', {
        detail: error?.message || String(error),
      }));
    } finally {
      if (fileSelectionRequestRef.current === requestId) setSelectingFile(false);
    }
  };

  const shellBackground = darkMode ? '#101319' : '#f5f7fb';
  const panelBackground = darkMode ? '#161b22' : '#ffffff';
  const panelBorder = darkMode
    ? '1px solid rgba(255,255,255,0.08)'
    : '1px solid rgba(15,23,42,0.08)';
  const selectedFileBackground = darkMode ? 'rgba(255,255,255,0.04)' : '#f8fafc';

  return (
    <div
      data-data-import-workbench="true"
      style={{
        display: 'flex',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        flexDirection: 'column',
        overflow: 'hidden',
        background: shellBackground,
      }}
    >
      <header style={{ padding: '20px 24px 16px', background: panelBackground, borderBottom: panelBorder }}>
        <Title level={4} style={{ margin: 0, letterSpacing: 0 }}>
          {t('data_import.workbench.title')}
        </Title>
        <Text type="secondary">{t('data_import.workbench.description')}</Text>
      </header>

      <div
        data-data-import-workbench-layout="true"
        style={{
          display: 'grid',
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)',
          gap: 20,
          overflow: 'auto',
          padding: 24,
          alignItems: 'start',
        }}
      >
        <section
          data-data-import-target-config="true"
          style={{ padding: 20, border: panelBorder, borderRadius: 8, background: panelBackground }}
        >
          <div style={{ marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            {t('data_import.workbench.section.target')}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <Text type="secondary">{t('data_import.workbench.label.connection')}</Text>
              <Select
                data-import-target-field="connection"
                value={selectedConnectionId || undefined}
                options={connectionOptions}
                placeholder={t('data_import.workbench.placeholder.select_connection')}
                showSearch
                optionFilterProp="title"
                disabled={targetLocked}
                onChange={handleConnectionChange}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <Text type="secondary">{t('data_import.workbench.label.database')}</Text>
              <Select
                data-import-target-field="database"
                value={selectedDbName || undefined}
                options={databaseOptions}
                placeholder={loadingDatabases
                  ? t('data_import.workbench.placeholder.loading_databases')
                  : t('data_import.workbench.placeholder.select_database')}
                loading={loadingDatabases}
                showSearch
                optionFilterProp="title"
                disabled={targetLocked || !selectedConnectionId || loadingDatabases}
                onChange={handleDatabaseChange}
              />
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <Text type="secondary">{t('data_import.workbench.label.table')}</Text>
              <Select
                data-import-target-field="table"
                value={selectedTableName || undefined}
                options={tableOptions}
                placeholder={!selectedDbName
                  ? t('data_import.workbench.placeholder.select_database_first')
                  : loadingTables
                    ? t('data_import.workbench.placeholder.loading_tables')
                    : t('data_import.workbench.placeholder.select_table')}
                loading={loadingTables}
                showSearch
                optionFilterProp="title"
                disabled={targetLocked || !selectedDbName || loadingTables}
                onChange={handleTableChange}
              />
            </label>

            {databaseError && <Alert type="error" showIcon message={databaseError} />}
            {tableError && <Alert type="error" showIcon message={tableError} />}

            <div style={{ display: 'grid', gap: 6 }}>
              <Text type="secondary">{t('data_import.workbench.label.file')}</Text>
              {filePath && (
                <div
                  title={filePath}
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: selectedFileBackground,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--gn-font-mono)',
                    fontSize: 12,
                  }}
                >
                  {getFileName(filePath)}
                </div>
              )}
              <Button
                data-import-select-file-action="true"
                type="primary"
                icon={filePath ? <FileAddOutlined /> : <ImportOutlined />}
                loading={selectingFile}
                disabled={importing || !selectedConnectionConfig || !selectedDbName || !selectedTableName}
                onClick={() => void handleSelectFile()}
              >
                {filePath
                  ? t('data_import.workbench.action.change_file')
                  : t('data_import.workbench.action.select_file')}
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('data_import.workbench.helper.file_formats')}
              </Text>
            </div>
          </div>
        </section>

        <section
          data-data-import-preview-panel="true"
          style={{
            minWidth: 0,
            minHeight: 420,
            padding: 20,
            border: panelBorder,
            borderRadius: 8,
            background: panelBackground,
          }}
        >
          {filePath ? (
            <ImportPreviewModal
              visible
              presentation="embedded"
              filePath={filePath}
              connectionId={selectedConnectionId}
              dbName={selectedDbName}
              tableName={selectedTableName}
              onClose={clearSelectedFile}
              onImportingChange={handleImportingChange}
              onSuccess={() => {
                void message.success(t('data_import.workbench.message.import_done'));
              }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={(
                <div style={{ display: 'grid', gap: 4 }}>
                  <Text strong>{t('data_import.workbench.state.awaiting_file_title')}</Text>
                  <Text type="secondary">{t('data_import.workbench.state.awaiting_file_description')}</Text>
                </div>
              )}
            />
          )}
        </section>
      </div>
    </div>
  );
};

export default DataImportWorkbench;
