import { useMemo } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import { downloadBrowserTextFile } from '../../utils/browserFileTransfer';
import {
  buildReverseScript,
  type DMLSnapshotDetail,
} from './dmlSnapshotModel';

interface DMLSnapshotDetailDrawerProps {
  open: boolean;
  loading: boolean;
  detail: DMLSnapshotDetail | null;
  error: string;
  onClose: () => void;
}

type StatementSection = {
  key: string;
  label: string;
  statements: string[];
};

// 与 requestDiagnostics / 审计中心一致：先试浏览器剪贴板，再退回 Wails 运行时。
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

export default function DMLSnapshotDetailDrawer({
  open,
  loading,
  detail,
  error,
  onClose,
}: DMLSnapshotDetailDrawerProps) {
  const { t } = useI18n();

  const script = useMemo(() => (detail ? buildReverseScript(detail) : ''), [detail]);

  const sections = useMemo<StatementSection[]>(() => {
    if (!detail) return [];
    return [
      { key: 'deletes', label: t('dml_snapshot.detail.undo_inserts'), statements: detail.deletes },
      { key: 'updates', label: t('dml_snapshot.detail.restore_updates'), statements: detail.updates },
      { key: 'inserts', label: t('dml_snapshot.detail.restore_deletes'), statements: detail.inserts },
    ].filter((section) => section.statements.length > 0);
  }, [detail, t]);

  const handleCopy = async () => {
    if (!script.trim()) return;
    try {
      await copyToClipboard(script);
      message.success(t('dml_snapshot.copy.success'));
    } catch {
      message.error(t('dml_snapshot.copy.failed'));
    }
  };

  const handleExport = () => {
    if (!script.trim() || !detail) return;
    // 文件名只带表名与快照 ID：连接名可能含路径分隔符，直接拼进文件名会失败。
    const safeTable = detail.table.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'snapshot';
    const fileName = `gonavi-reverse-${safeTable}-${detail.id.replace(/[^a-zA-Z0-9_-]+/g, '_')}.sql`;
    const ok = downloadBrowserTextFile(script, fileName, 'application/sql');
    if (ok) {
      message.success(t('dml_snapshot.export.success'));
    } else {
      message.error(t('dml_snapshot.export.failed'));
    }
  };

  return (
    <Drawer
      title={t('dml_snapshot.detail.title')}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

      {detail ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {!detail.cannotFullyRestore ? (
            <Alert type="success" showIcon message={t('dml_snapshot.restorable.yes')} />
          ) : (
            <Alert
              type="warning"
              showIcon
              message={t('dml_snapshot.restorable.no')}
              description={
                detail.skipped.length > 0
                  ? t('dml_snapshot.summary.skipped', { count: detail.skipped.length })
                  : undefined
              }
            />
          )}

          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label={t('dml_snapshot.column.time')}>{detail.createdAt || '-'}</Descriptions.Item>
            <Descriptions.Item label={t('dml_snapshot.column.table')}>{detail.table || '-'}</Descriptions.Item>
            <Descriptions.Item label={t('dml_snapshot.column.connection')}>{detail.connection || '-'}</Descriptions.Item>
            <Descriptions.Item label={t('dml_snapshot.column.database')}>{detail.dbName || '-'}</Descriptions.Item>
          </Descriptions>

          {sections.length === 0 ? (
            <Empty description={t('dml_snapshot.detail.no_statements')} />
          ) : (
            <>
              <Alert type="info" showIcon message={t('dml_snapshot.detail.replay_order')} />
              {sections.map((section) => (
                <div key={section.key} className="gn-dml-snapshot-script-block">
                  <Typography.Title level={5} style={{ marginTop: 0 }}>
                    {section.label}
                    <Tag style={{ marginLeft: 8 }}>{section.statements.length}</Tag>
                  </Typography.Title>
                  <pre className="gn-dml-snapshot-sql">{section.statements.join('\n')}</pre>
                </div>
              ))}
            </>
          )}

          {detail.skipped.length > 0 ? (
            <div>
              <Typography.Title level={5}>{t('dml_snapshot.detail.skipped_title')}</Typography.Title>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {detail.skipped.map((row, index) => (
                  <div key={`${row.group}-${row.index}-${index}`} className="gn-dml-snapshot-skipped-row">
                    <Tag>{t(`dml_snapshot.detail.group.${row.group}`)}</Tag>
                    <span>{t('dml_snapshot.detail.skipped_row', { index: row.index })}</span>
                    <span className="gn-dml-snapshot-skipped-reason">{row.reason ? t(row.reason) : ''}</span>
                  </div>
                ))}
              </Space>
            </div>
          ) : null}

          <Space>
            <Button icon={<CopyOutlined />} onClick={handleCopy} disabled={!script.trim()}>
              {t('dml_snapshot.action.copy')}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!script.trim()}>
              {t('dml_snapshot.action.export')}
            </Button>
          </Space>
        </Space>
      ) : loading ? null : (
        <Empty description={t('dml_snapshot.detail.no_statements')} />
      )}
    </Drawer>
  );
}
