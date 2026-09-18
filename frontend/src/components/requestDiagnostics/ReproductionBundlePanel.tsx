import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Modal, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, ImportOutlined, ReloadOutlined } from '@ant-design/icons';
import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { I18nParams } from '../../i18n/types';
import { downloadBrowserTextFile } from '../../utils/browserFileTransfer';
import {
  unwrapRequestDiagnostics,
  type ReproductionBundlePreview,
  type ReproductionBundleSourcePage,
  type ReproductionBundleSourceSummary,
  type RequestDiagnosticsBackend,
} from './requestDiagnosticsRpc';

const { Text, Title } = Typography;
const MAX_REPRODUCTION_BUNDLE_BYTES = 1024 * 1024;

type PanelTranslate = (key: string, params?: I18nParams) => string;

const emptySourcePage = (): ReproductionBundleSourcePage => ({ items: [], warnings: [] });

const formatTimestamp = (timestamp?: number): string => (
  timestamp && timestamp > 0 ? new Date(timestamp).toLocaleString() : '-'
);

const sourceKindLabel = (kind: string | undefined, translate: PanelTranslate): string => {
  switch (kind) {
    case 'query': return translate('request_diagnostics.reproduction.source_kind.query');
    case 'sync': return translate('request_diagnostics.reproduction.source_kind.sync');
    case 'import': return translate('request_diagnostics.reproduction.source_kind.import');
    case 'mcp': return 'MCP';
    default: return translate('request_diagnostics.reproduction.source_kind.unknown');
  }
};

const isWebRuntime = (): boolean => typeof window !== 'undefined'
  && (window as any).__GONAVI_WEB_RUNTIME__?.buildType === 'web';

const isCancelledResult = (result: { success?: boolean; message?: string }): boolean => {
  const detail = String(result?.message || '').trim().toLowerCase();
  return result?.success === false && (detail === 'cancelled' || detail === '已取消');
};

export default function ReproductionBundlePanel({
  backend,
  isActive,
}: {
  backend: RequestDiagnosticsBackend;
  isActive: boolean;
}) {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? ((key: string, params?: I18nParams) => catalogTranslate('en-US', key, params));
  const [page, setPage] = useState<ReproductionBundleSourcePage>(emptySourcePage);
  const [loading, setLoading] = useState(false);
  const [busySource, setBusySource] = useState('');
  const [importContent, setImportContent] = useState('');
  const [importPreview, setImportPreview] = useState<ReproductionBundlePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (typeof backend.ListReproductionBundleSources !== 'function') {
      setPage(emptySourcePage());
      return;
    }
    setLoading(true);
    try {
      const result = await backend.ListReproductionBundleSources();
      const next = unwrapRequestDiagnostics(result) || emptySourcePage();
      setPage({ items: next.items || [], warnings: next.warnings || [] });
    } catch (cause) {
      setPage({ items: [], warnings: [cause instanceof Error ? cause.message : String(cause)] });
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  const exportSource = useCallback(async (source: ReproductionBundleSourceSummary) => {
    const sourceKey = `${source.kind}:${source.id}`;
    setBusySource(sourceKey);
    try {
      if (!isWebRuntime() && typeof backend.ExportReproductionBundle === 'function') {
        const result = await backend.ExportReproductionBundle(source.kind, source.id);
        if (isCancelledResult(result)) return;
        const data = unwrapRequestDiagnostics(result) || {};
        const path = String(data.path || data.filePath || '').trim();
        message.success(path
          ? t('request_diagnostics.reproduction.success_exported_to', { path })
          : t('request_diagnostics.reproduction.success_exported'));
        return;
      }
      if (typeof backend.BuildReproductionBundle !== 'function') {
        throw new Error(t('request_diagnostics.reproduction.error_backend_unavailable'));
      }
      const data = unwrapRequestDiagnostics(await backend.BuildReproductionBundle(source.kind, source.id)) || {};
      const content = String(data.content || '');
      const fileName = String(data.fileName || `gonavi-reproduction-${source.kind}.json`);
      const mimeType = String(data.mimeType || 'application/json;charset=utf-8');
      if (!content || !downloadBrowserTextFile(content, fileName, mimeType)) {
        throw new Error(t('request_diagnostics.reproduction.error_download_unsupported'));
      }
      message.success(t('request_diagnostics.reproduction.success_downloaded'));
    } catch (cause) {
      message.error(t('request_diagnostics.reproduction.error_export', {
        detail: cause instanceof Error ? cause.message : String(cause),
      }));
    } finally {
      setBusySource('');
    }
  }, [backend, t]);

  const readImportedBundle = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_REPRODUCTION_BUNDLE_BYTES) {
      message.error(t('request_diagnostics.reproduction.error_size_limit'));
      return;
    }
    if (typeof backend.PreviewReproductionBundle !== 'function') {
      message.error(t('request_diagnostics.reproduction.error_preview_backend'));
      return;
    }
    setPreviewLoading(true);
    try {
      const content = await file.text();
      const preview = unwrapRequestDiagnostics(await backend.PreviewReproductionBundle(content));
      setImportContent(content);
      setImportPreview(preview);
      setPreviewOpen(true);
    } catch (cause) {
      message.error(t('request_diagnostics.reproduction.error_import', {
        detail: cause instanceof Error ? cause.message : String(cause),
      }));
    } finally {
      setPreviewLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelImport = () => {
    setPreviewOpen(false);
    setImportPreview(null);
    setImportContent('');
  };

  const replayImportedBundle = async () => {
    if (!importContent || typeof backend.ReplayReproductionBundle !== 'function') return;
    setReplaying(true);
    try {
      const replay = unwrapRequestDiagnostics(await backend.ReplayReproductionBundle(importContent));
      if (!replay?.reproduced) {
        throw new Error(t('request_diagnostics.reproduction.error_replay_mismatch'));
      }
      message.success(t('request_diagnostics.reproduction.success_replay', {
        summary: `${replay?.sourceKind || 'unknown'} / ${replay?.errorKind || replay?.status || 'failed'}`,
      }));
      cancelImport();
    } catch (cause) {
      message.error(t('request_diagnostics.reproduction.error_replay', {
        detail: cause instanceof Error ? cause.message : String(cause),
      }));
    } finally {
      setReplaying(false);
    }
  };

  const columns = useMemo<ColumnsType<ReproductionBundleSourceSummary>>(() => [
    { title: t('request_diagnostics.reproduction.column.kind'), dataIndex: 'kind', width: 88, render: (value: string) => <Tag>{sourceKindLabel(value, t)}</Tag> },
    { title: t('request_diagnostics.reproduction.column.status'), dataIndex: 'status', width: 112, render: (value: string) => <Tag color="error">{value || 'failed'}</Tag> },
    { title: t('request_diagnostics.reproduction.column.error_kind'), dataIndex: 'errorKind', ellipsis: true, render: (value: string) => value || 'execution' },
    { title: t('request_diagnostics.reproduction.column.time'), dataIndex: 'updatedAt', width: 180, render: formatTimestamp },
    {
      title: t('request_diagnostics.reproduction.column.action'), key: 'action', width: 112, render: (_value, source) => (
        <Button
          size="small"
          icon={<DownloadOutlined />}
          loading={busySource === `${source.kind}:${source.id}`}
          onClick={() => void exportSource(source)}
        >
          {t('request_diagnostics.reproduction.action_generate')}
        </Button>
      ),
    },
  ], [busySource, exportSource, t]);

  return (
    <section className="gn-reproduction-bundle-panel" aria-label={t('request_diagnostics.reproduction.aria_label')}>
      <header className="gn-reproduction-bundle-panel__header">
        <div>
          <Title level={4}>{t('request_diagnostics.reproduction.title')}</Title>
          <Text type="secondary">{t('request_diagnostics.reproduction.description')}</Text>
          <br />
          <Text type="secondary">{t('request_diagnostics.reproduction.privacy')}</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{t('request_diagnostics.reproduction.action_refresh')}</Button>
          <Button icon={<ImportOutlined />} loading={previewLoading} onClick={() => fileInputRef.current?.click()}>{t('request_diagnostics.reproduction.action_import')}</Button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label={t('request_diagnostics.reproduction.file_aria_label')}
            onChange={(event) => void readImportedBundle(event.target.files?.[0])}
          />
        </Space>
      </header>
      {(page.warnings || []).map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}
      <Table
        size="small"
        rowKey={(source) => `${source.kind}:${source.id}`}
        dataSource={page.items || []}
        columns={columns}
        pagination={false}
        loading={loading}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('request_diagnostics.reproduction.empty')} /> }}
        scroll={{ x: 760 }}
      />
      <Modal
        open={previewOpen}
        title={t('request_diagnostics.reproduction.modal_title')}
        okText={t('request_diagnostics.reproduction.modal_ok')}
        cancelText={t('common.cancel')}
        confirmLoading={replaying}
        okButtonProps={{ disabled: !importPreview?.offlineOnly || !importContent }}
        onCancel={cancelImport}
        onOk={() => void replayImportedBundle()}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message={t('request_diagnostics.reproduction.offline_only_title')}
          description={t('request_diagnostics.reproduction.offline_only_description')}
        />
        <Descriptions size="small" bordered column={1} style={{ marginTop: 16 }}>
          <Descriptions.Item label={t('request_diagnostics.reproduction.field.source')}>{sourceKindLabel(importPreview?.source?.kind, t)}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.reproduction.field.app_version')}>{importPreview?.appVersion || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.reproduction.field.event_count')}>{importPreview?.eventCount || 0}</Descriptions.Item>
          <Descriptions.Item label={t('request_diagnostics.reproduction.field.fixture_engine')}>{importPreview?.fixtureEngine || '-'}</Descriptions.Item>
        </Descriptions>
        <section style={{ marginTop: 16 }}>
          <Text strong>{t('request_diagnostics.reproduction.capabilities_title')}</Text>
          <Space wrap style={{ marginTop: 8 }}>
            {Object.entries(importPreview?.capabilities || {}).map(([key, value]) => (
              <Tag key={key}>{key}: {value}</Tag>
            ))}
          </Space>
        </section>
        <section style={{ marginTop: 16 }}>
          <Text strong>{t('request_diagnostics.reproduction.redaction_title')}</Text>
          <Space wrap style={{ marginTop: 8 }}>
            {Object.entries(importPreview?.redaction || {}).map(([key, value]) => (
              <Tag key={key} color="green">{key}: {value}</Tag>
            ))}
          </Space>
        </section>
      </Modal>
    </section>
  );
}
