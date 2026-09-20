import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Space, Table, Tag, Typography } from 'antd';
import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useI18n } from '../../i18n/provider';
import {
  normalizeDMLSnapshotDetail,
  normalizeDMLSnapshotList,
  type DMLSnapshotDetail,
  type DMLSnapshotSummary,
} from './dmlSnapshotModel';
import {
  DMLSnapshotBackendMessage,
  requireDMLSnapshotMethod,
  resolveDMLSnapshotBackend,
  unwrapDMLSnapshotResult,
  type DMLSnapshotBackend,
} from './dmlSnapshotRpc';
import DMLSnapshotDetailDrawer from './DMLSnapshotDetailDrawer';
import './DMLSnapshotWorkbench.css';

interface DMLSnapshotWorkbenchProps {
  backend?: DMLSnapshotBackend;
  isActive?: boolean;
}

export default function DMLSnapshotWorkbench({
  backend: backendOverride,
  isActive = true,
}: DMLSnapshotWorkbenchProps) {
  const { t } = useI18n();
  const backend = backendOverride ?? resolveDMLSnapshotBackend();

  const [summaries, setSummaries] = useState<DMLSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<DMLSnapshotDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // 竞态守卫：刷新按钮可连点，只允许最后一次请求落地。
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const list = requireDMLSnapshotMethod(backend, 'ListDMLSnapshots');
        const data = unwrapDMLSnapshotResult(await list());
        if (requestRef.current !== requestId) return;
        setSummaries(normalizeDMLSnapshotList(data));
      } catch (err) {
        if (requestRef.current !== requestId) return;
        // 仅后端经 appText 本地化的 message 可直接展示；
        // 其余（方法缺失等）一律换成本地化文案，避免内部英文串泄漏到界面。
        setLoadError(err instanceof DMLSnapshotBackendMessage
          ? err.message
          : t('dml_snapshot.error.load_failed'));
        setSummaries([]);
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    };

    void load();
  }, [backend, refreshKey, t]);

  const openDetail = useCallback(async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      const getDetail = requireDMLSnapshotMethod(backend, 'GetDMLSnapshot');
      const data = unwrapDMLSnapshotResult(await getDetail(id));
      setDetail(normalizeDMLSnapshotDetail(data));
    } catch (err) {
      // 同列表路径：只透出后端本地化 message，内部异常换兜底文案。
      setDetailError(err instanceof DMLSnapshotBackendMessage
        ? err.message
        : t('dml_snapshot.error.detail_failed'));
    } finally {
      setDetailLoading(false);
    }
  }, [backend, t]);

  const columns = useMemo<ColumnsType<DMLSnapshotSummary>>(() => [
    {
      title: t('dml_snapshot.column.time'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 200,
      render: (value: string) => value || '-',
    },
    {
      title: t('dml_snapshot.column.table'),
      dataIndex: 'table',
      key: 'table',
      width: 180,
      render: (value: string) => value || '-',
    },
    {
      title: t('dml_snapshot.column.connection'),
      dataIndex: 'connection',
      key: 'connection',
      width: 160,
      render: (value: string) => value || '-',
    },
    {
      title: t('dml_snapshot.column.statements'),
      dataIndex: 'statementCount',
      key: 'statementCount',
      width: 140,
      render: (_: number, record) => t('dml_snapshot.summary.statements', { count: record.statementCount }),
    },
    {
      title: t('dml_snapshot.column.restorable'),
      key: 'restorable',
      width: 180,
      render: (_: unknown, record) => (
        record.cannotFullyRestore ? (
          <Tag color="warning">{t('dml_snapshot.restorable.no')}</Tag>
        ) : (
          <Tag color="success">{t('dml_snapshot.restorable.yes')}</Tag>
        )
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record) => (
        <Button type="link" size="small" onClick={() => void openDetail(record.id)}>
          {t('dml_snapshot.action.view')}
        </Button>
      ),
    },
  ], [openDetail, t]);

  return (
    <section className="gn-dml-snapshot-workbench" aria-label={t('dml_snapshot.workbench.aria_label')}>
      <header className="gn-dml-snapshot-header">
        <div className="gn-dml-snapshot-title-group">
          <span className="gn-dml-snapshot-title-icon"><HistoryOutlined /></span>
          <div className="gn-dml-snapshot-title-copy">
            <Typography.Title level={4}>{t('dml_snapshot.workbench.title')}</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t('dml_snapshot.workbench.description')}
            </Typography.Paragraph>
          </div>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => setRefreshKey((current) => current + 1)}
        >
          {t('dml_snapshot.action.refresh')}
        </Button>
      </header>

      <Alert
        type="warning"
        showIcon
        message={t('dml_snapshot.notice.title')}
        description={(
          <Space direction="vertical" size={2}>
            <span>{t('dml_snapshot.notice.manual')}</span>
            <span>{t('dml_snapshot.notice.concurrent')}</span>
            <span>{t('dml_snapshot.notice.conflict')}</span>
            <span>{t('dml_snapshot.notice.trigger')}</span>
            <span>{t('dml_snapshot.notice.retention')}</span>
          </Space>
        )}
      />

      {/* 失败时只显示错误，不再叠加一个"无数据"表格 —— 那会让人以为快照真的为空。 */}
      {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

      {loadError ? null : !loading && summaries.length === 0 ? (
        <Empty
          description={(
            <Space direction="vertical" size={2}>
              <span>{t('dml_snapshot.empty')}</span>
              <Typography.Text type="secondary">{t('dml_snapshot.empty_hint')}</Typography.Text>
            </Space>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={loading && isActive}
          columns={columns}
          dataSource={summaries}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
        />
      )}

      <DMLSnapshotDetailDrawer
        open={detailOpen}
        loading={detailLoading}
        detail={detail}
        error={detailError}
        onClose={() => setDetailOpen(false)}
      />
    </section>
  );
}
