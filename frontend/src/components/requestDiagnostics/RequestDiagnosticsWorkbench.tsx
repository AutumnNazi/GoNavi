import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CopyOutlined, DownloadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import type { TabData } from '../../types';
import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { I18nParams } from '../../i18n/types';
import { downloadBrowserTextFile } from '../../utils/browserFileTransfer';
import {
  emptyRequestTracePage,
  formatTraceBytes,
  normalizeRequestTracePage,
  requestTraceStatusColor,
  type RequestTraceRecord,
} from './requestDiagnosticsModel';
import {
  resolveRequestDiagnosticsBackend,
  unwrapRequestDiagnostics,
  type DatabaseDiagnosticPreview,
  type RequestDiagnosticsBackend,
} from './requestDiagnosticsRpc';
import ReproductionBundlePanel from './ReproductionBundlePanel';
import './RequestDiagnosticsWorkbench.css';

const { Text, Title } = Typography;

interface RequestDiagnosticsWorkbenchProps {
  tab: TabData;
  backend?: RequestDiagnosticsBackend;
  isActive?: boolean;
}

type WorkbenchTranslate = (key: string, params?: I18nParams) => string;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
  hour12: false,
});

const formatTimestamp = (timestamp?: number): string => (
  timestamp && timestamp > 0 ? dateFormatter.format(new Date(timestamp)) : '-'
);

const copyToClipboard = async (content: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const runtimeClipboard = (window as any).runtime?.ClipboardSetText;
  if (typeof runtimeClipboard === 'function') {
    await runtimeClipboard(content);
    return;
  }
  throw new Error('Clipboard unavailable');
};

const cancellationLabel = (trace: RequestTraceRecord, translate: WorkbenchTranslate): string => {
  const cancellation = trace.cancellation;
  if (!cancellation?.requested) return translate('request_diagnostics.workbench.cancellation.not_requested');
  switch (cancellation.outcome) {
    case 'observed': return translate('request_diagnostics.workbench.cancellation.observed');
    case 'not_observed': return translate('request_diagnostics.workbench.cancellation.not_observed');
    case 'not_accepted': return translate('request_diagnostics.workbench.cancellation.not_accepted');
    case 'forwarded': return translate('request_diagnostics.workbench.cancellation.forwarded');
    default: return translate('request_diagnostics.workbench.cancellation.unknown');
  }
};

const databaseDiagnosticConnectionStateLabel = (state: string | undefined, translate: WorkbenchTranslate): string => {
  switch (state) {
    case 'no_connection': return translate('request_diagnostics.workbench.connection_state.no_connection');
    case 'connected': return translate('request_diagnostics.workbench.connection_state.connected');
    case 'multiple_connections': return translate('request_diagnostics.workbench.connection_state.multiple_connections');
    case 'multiple_drivers': return translate('request_diagnostics.workbench.connection_state.multiple_drivers');
    default: return translate('request_diagnostics.workbench.connection_state.unknown');
  }
};

export default function RequestDiagnosticsWorkbench({
  tab: _tab,
  backend: backendOverride,
  isActive = true,
}: RequestDiagnosticsWorkbenchProps) {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? ((key: string, params?: I18nParams) => catalogTranslate('en-US', key, params));
  const backend = backendOverride ?? resolveRequestDiagnosticsBackend();
  const [entry, setEntry] = useState<string | undefined>();
  const [requestID, setRequestID] = useState('');
  const [page, setPage] = useState(emptyRequestTracePage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RequestTraceRecord | null>(null);
  const [packagePreview, setPackagePreview] = useState<DatabaseDiagnosticPreview | null>(null);
  const [packagePreviewOpen, setPackagePreviewOpen] = useState(false);
  const [packagePreviewLoading, setPackagePreviewLoading] = useState(false);
  const [packageExporting, setPackageExporting] = useState(false);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    try {
      if (typeof backend.GetRequestDiagnostics !== 'function') {
        throw new Error(t('request_diagnostics.workbench.error_backend_unavailable'));
      }
      const payload = await backend.GetRequestDiagnostics({
        requestId: requestID.trim() || undefined,
        entry,
        limit: 200,
      });
      if (sequence !== requestSequence.current) return;
      setPage(normalizeRequestTracePage(unwrapRequestDiagnostics(payload)));
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setPage(emptyRequestTracePage());
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [backend, entry, requestID, t]);

  useEffect(() => {
    if (!isActive) return undefined;
    void load();
    return () => { requestSequence.current += 1; };
  }, [isActive, load]);

  const entryOptions = useMemo(() => Array.from(new Set(page.items.map((item) => item.entry).filter(Boolean)))
    .sort()
    .map((value) => ({ value, label: value.toUpperCase() })), [page.items]);

  const columns = useMemo<ColumnsType<RequestTraceRecord>>(() => [
    {
      title: t('request_diagnostics.workbench.column.time'),
      dataIndex: 'startedAt',
      key: 'startedAt',
      width: 172,
      render: (value: number) => <time dateTime={value ? new Date(value).toISOString() : undefined}>{formatTimestamp(value)}</time>,
    },
    {
      title: t('request_diagnostics.workbench.column.entry'),
      dataIndex: 'entry',
      key: 'entry',
      width: 88,
      render: (value: string) => <Tag>{value || '-'}</Tag>,
    },
    {
      title: t('request_diagnostics.workbench.column.operation'),
      dataIndex: 'operation',
      key: 'operation',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('request_diagnostics.workbench.column.datasource_driver'),
      key: 'driver',
      width: 168,
      render: (_value, record) => (
        <span>{[record.dataSourceType, record.driverMode].filter(Boolean).join(' · ') || '-'}</span>
      ),
    },
    {
      title: t('request_diagnostics.workbench.column.status'),
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (value: string) => <Tag color={requestTraceStatusColor(value)}>{value || 'unknown'}</Tag>,
    },
    {
      title: t('request_diagnostics.workbench.column.duration'),
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 92,
      align: 'right',
      render: (value: number) => value ? `${value.toLocaleString()} ms` : '-',
    },
    {
      title: t('request_diagnostics.workbench.column.retry'),
      dataIndex: 'retryCount',
      key: 'retryCount',
      width: 76,
      align: 'right',
      render: (value: number) => value || 0,
    },
    {
      title: t('request_diagnostics.workbench.column.action'),
      key: 'action',
      width: 68,
      fixed: 'right',
      render: (_value, record) => (
        <Tooltip title={t('request_diagnostics.workbench.action_view_trace')}>
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={(event) => {
            event.stopPropagation();
            setSelected(record);
          }} />
        </Tooltip>
      ),
    },
  ], [t]);

  const copySelected = async () => {
    if (!selected) return;
    try {
      await copyToClipboard(JSON.stringify(selected, null, 2));
      message.success(t('request_diagnostics.workbench.success_copy'));
    } catch {
      message.error(t('request_diagnostics.workbench.error_copy'));
    }
  };

  const exportSelected = () => {
    if (!selected) return;
    const requestID = selected.requestId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
    const exported = downloadBrowserTextFile(
      JSON.stringify(selected, null, 2),
      `gonavi-request-trace-${requestID}.json`,
      'application/json;charset=utf-8',
    );
    if (exported) {
      message.success(t('request_diagnostics.workbench.success_export'));
      return;
    }
    message.error(t('request_diagnostics.workbench.error_export_unsupported'));
  };

  const openDatabaseDiagnosticPackagePreview = async () => {
    if (typeof backend.GetDatabaseDiagnosticPackagePreview !== 'function') {
      message.error(t('request_diagnostics.workbench.error_package_backend_unavailable'));
      return;
    }
    setPackagePreviewLoading(true);
    try {
      const result = await backend.GetDatabaseDiagnosticPackagePreview();
      setPackagePreview(unwrapRequestDiagnostics(result));
      setPackagePreviewOpen(true);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      message.error(t('request_diagnostics.workbench.error_package_prepare', { detail }));
    } finally {
      setPackagePreviewLoading(false);
    }
  };

  const exportDatabaseDiagnosticPackage = async () => {
    if (!packagePreview) return;
    setPackageExporting(true);
    try {
      const isWebRuntime = typeof window !== 'undefined'
        && (window as any).__GONAVI_WEB_RUNTIME__?.buildType === 'web';
      if (!isWebRuntime && typeof backend.ExportDatabaseDiagnosticPackage === 'function') {
        const result = await backend.ExportDatabaseDiagnosticPackage();
        const cancellationMessage = String(result?.message || '').trim().toLocaleLowerCase();
        if (result?.success === false && (cancellationMessage === 'cancelled' || cancellationMessage === '已取消')) {
          return;
        }
        const data = unwrapRequestDiagnostics(result) || {};
        const path = String(data.path || data.filePath || '').trim();
        message.success(path
          ? t('request_diagnostics.workbench.success_package_exported_to', { path })
          : t('request_diagnostics.workbench.success_package_exported'));
        setPackagePreviewOpen(false);
        return;
      }
      if (typeof backend.BuildDatabaseDiagnosticPackage !== 'function') {
        throw new Error(t('request_diagnostics.workbench.error_package_export_backend_unavailable'));
      }
      const data = unwrapRequestDiagnostics(await backend.BuildDatabaseDiagnosticPackage()) || {};
      const content = String(data.content || '');
      const fileName = String(data.fileName || 'gonavi-database-diagnostics.json');
      const mimeType = String(data.mimeType || 'application/json;charset=utf-8');
      if (!content || !downloadBrowserTextFile(content, fileName, mimeType)) {
        throw new Error(t('request_diagnostics.workbench.error_package_download_unsupported'));
      }
      message.success(t('request_diagnostics.workbench.success_package_downloaded'));
      setPackagePreviewOpen(false);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      message.error(t('request_diagnostics.workbench.error_package_export', { detail }));
    } finally {
      setPackageExporting(false);
    }
  };

  return (
    <section className="gn-request-diagnostics-workbench" aria-label={t('request_diagnostics.workbench.aria_label')}>
      <header className="gn-request-diagnostics-header">
        <div>
          <Title level={3}>{t('request_diagnostics.workbench.title')}</Title>
          <Text type="secondary">{t('request_diagnostics.workbench.privacy_summary')}</Text>
          <br />
          <Text type="secondary">{t('request_diagnostics.workbench.privacy_export')}</Text>
        </div>
        <Space wrap>
          <Input
            allowClear
            aria-label={t('request_diagnostics.workbench.filter_aria_label')}
            placeholder={t('request_diagnostics.workbench.filter_placeholder')}
            value={requestID}
            onChange={(event) => setRequestID(event.target.value)}
            style={{ width: 244 }}
          />
          <Select
            allowClear
            placeholder={t('request_diagnostics.workbench.entry_filter_placeholder')}
            value={entry}
            options={entryOptions}
            onChange={setEntry}
            style={{ minWidth: 132 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>{t('request_diagnostics.workbench.action_refresh')}</Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => void openDatabaseDiagnosticPackagePreview()}
            loading={packagePreviewLoading}
          >
            {t('request_diagnostics.workbench.action_generate_package')}
          </Button>
        </Space>
      </header>
      {error ? <Alert type="warning" showIcon message={t('request_diagnostics.workbench.error_read')} description={error} /> : null}
      <div className="gn-request-diagnostics-summary" aria-live="polite">
        <span>{t('request_diagnostics.workbench.summary_loaded', { loaded: page.items.length, total: page.total })}</span>
        <span>{t('request_diagnostics.workbench.summary_eviction')}</span>
      </div>
      <div className="gn-request-diagnostics-table">
        <Spin spinning={loading}>
          <Table
            size="middle"
            rowKey="requestId"
            dataSource={page.items}
            columns={columns}
            pagination={false}
            scroll={{ x: 1080, y: 'calc(100vh - 360px)' }}
            locale={{ emptyText: <Empty description={t('request_diagnostics.workbench.empty_traces')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            onRow={(record) => ({ onClick: () => setSelected(record) })}
            rowClassName="gn-request-diagnostics-row"
          />
        </Spin>
      </div>
      <ReproductionBundlePanel backend={backend} isActive={isActive} />
      <Modal
        open={packagePreviewOpen}
        title={t('request_diagnostics.workbench.package_modal_title')}
        okText={t('request_diagnostics.workbench.package_modal_ok')}
        cancelText={t('common.cancel')}
        confirmLoading={packageExporting}
        okButtonProps={{ disabled: !packagePreview }}
        onCancel={() => setPackagePreviewOpen(false)}
        onOk={() => void exportDatabaseDiagnosticPackage()}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message={t('request_diagnostics.workbench.package_privacy_title')}
          description={t('request_diagnostics.workbench.package_privacy_description')}
        />
        <Descriptions size="small" bordered column={1} style={{ marginTop: 16 }}>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.format')}>{String(packagePreview?.format || 'json').toUpperCase()}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.connection_summary')}>{packagePreview?.connectionCount || 0}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.request_traces')}>{packagePreview?.requestTraceCount || 0}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.running_queries')}>{packagePreview?.runningQueryCount || 0}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.pending_transactions')}>{packagePreview?.pendingTransactionCount || 0}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.slow_queries')}>{packagePreview?.slowQuerySummaryCount || 0}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.connection_state')}>{databaseDiagnosticConnectionStateLabel(packagePreview?.sources?.connectionState, t)}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.workbench.package_field.driver_types')}>{packagePreview?.sources?.driverTypes?.join(' · ') || '-'}</Descriptions.Item>
        </Descriptions>
        <section style={{ marginTop: 16 }}>
          <Text strong>{t('request_diagnostics.workbench.package_scope_included')}</Text>
          <ul>
            {(packagePreview?.scope?.included || []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section>
          <Text strong>{t('request_diagnostics.workbench.package_scope_excluded')}</Text>
          <ul>
            {(packagePreview?.scope?.excluded || []).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <Space wrap>
          {Object.entries(packagePreview?.redaction || {}).map(([key, value]) => (
            <Tag key={key} color={value === 'excluded' ? 'green' : 'default'}>{key}: {value}</Tag>
          ))}
        </Space>
      </Modal>
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        width="min(760px, calc(100vw - 24px))"
        title={t('request_diagnostics.workbench.detail_title')}
        extra={(
          <Space size={4}>
            <Button size="small" icon={<DownloadOutlined />} onClick={exportSelected}>{t('request_diagnostics.workbench.detail_export_json')}</Button>
            <Button size="small" icon={<CopyOutlined />} onClick={() => void copySelected()}>{t('request_diagnostics.workbench.detail_copy_json')}</Button>
          </Space>
        )}
        destroyOnHidden
      >
        {selected ? (
          <div className="gn-request-diagnostics-detail">
            <section>
              <Title level={5}>{t('request_diagnostics.workbench.detail_summary_title')}</Title>
              <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.request_id')} span={2}><Text code copyable={{ text: selected.requestId }}>{selected.requestId || '-'}</Text></Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.entry')}>{selected.entry || '-'}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.operation')}>{selected.operation || '-'}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.datasource')}>{selected.dataSourceType || '-'}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.driver_mode')}>{selected.driverMode || '-'}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.started_at')}>{formatTimestamp(selected.startedAt)}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.deadline_at')}>{formatTimestamp(selected.deadlineAt)}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.status')}><Tag color={requestTraceStatusColor(selected.status)}>{selected.status}</Tag></Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.duration')}>{selected.durationMs ? `${selected.durationMs.toLocaleString()} ms` : '-'}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.response_bytes')}>{formatTraceBytes(selected.responseBytes || 0, selected.responseBytesExact === true)}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.pagination')}>{selected.pagination?.resultSetCount ? `${t('request_diagnostics.workbench.detail_pagination_summary', { resultSets: selected.pagination.resultSetCount, rows: selected.pagination.returnedRows || 0 })}${selected.pagination.truncated ? t('request_diagnostics.workbench.detail_pagination_truncated') : ''}` : '-'}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.retry_count')}>{selected.retryCount || 0}</Descriptions.Item>
                <Descriptions.Item label={t('request_diagnostics.workbench.detail_field.cancellation')} span={2}><Tag color={selected.cancellation?.outcome === 'not_accepted' || selected.cancellation?.outcome === 'not_observed' ? 'warning' : 'default'}>{cancellationLabel(selected, t)}</Tag></Descriptions.Item>
              </Descriptions>
            </section>
            {selected.error?.message ? <Alert type="error" showIcon message={t('request_diagnostics.workbench.detail_error_mapping', { kind: selected.error.kind || 'execution' })} description={selected.error.message} /> : null}
            <section>
              <Title level={5}>{t('request_diagnostics.workbench.detail_timeline_title')}</Title>
              {selected.events?.length ? (
                <ol className="gn-request-diagnostics-timeline">
                  {selected.events.map((event, index) => (
                    <li key={`${event.timestamp}-${event.name}-${index}`}>
                      <div><Text strong>{event.name}</Text><time>{formatTimestamp(event.timestamp)}</time></div>
                      {event.details && Object.keys(event.details).length > 0 ? <pre>{JSON.stringify(event.details, null, 2)}</pre> : null}
                    </li>
                  ))}
                </ol>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('request_diagnostics.workbench.detail_no_events')} />}
            </section>
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}
