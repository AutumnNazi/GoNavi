import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import {
  LOG_STATUS_ALL,
  formatXxlJobTime,
  isXxlJobLogRunning,
  type XxlJobLog,
  type XxlJobLogDetail,
} from './xxljobModel';
import { useXxlJobLogs } from './hooks/useXxlJobLogs';
import { toGroupOptions, useXxlJobGroups } from './hooks/useXxlJobGroups';

const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

type Props = {
  connectionId: string;
  isActive: boolean;
};

// 详情抽屉：按 fromLineNum 续读调度中心转发的执行器滚动日志。
const XxlJobLogDetailDrawer: React.FC<{
  open: boolean;
  logId: number | null;
  readOnly: boolean;
  busy: boolean;
  fetchDetail: (logId: number, fromLineNum: number) => Promise<{ success: boolean; message?: string; data?: XxlJobLogDetail } | null>;
  kill: (logId: number) => Promise<{ success: boolean; message?: string } | null>;
  onClose: () => void;
}> = ({ open, logId, readOnly, busy, fetchDetail, kill, onClose }) => {
  const [content, setContent] = useState('');
  const [nextLine, setNextLine] = useState(1);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const readFrom = useCallback(async (fromLineNum: number, append: boolean) => {
    if (logId == null) return;
    setLoading(true);
    setError('');
    const result = await fetchDetail(logId, fromLineNum);
    if (!result?.success) {
      setError(String(result?.message ?? t('xxljob.message.detail_failed')));
      setLoading(false);
      return;
    }
    const detail = result.data;
    if (detail) {
      const slice = detail.logContent ?? '';
      setContent((prev) => (append && prev ? `${prev}${slice}` : slice));
      setNextLine(Math.max(detail.toLineNum, detail.fromLineNum));
      setEnded(Boolean(detail.isEnd));
    }
    setLoading(false);
  }, [fetchDetail, logId]);

  useEffect(() => {
    if (!open) {
      setContent('');
      setNextLine(1);
      setEnded(false);
      setError('');
      return;
    }
    void readFrom(1, false);
  }, [open, readFrom]);

  const runKill = async () => {
    if (logId == null) return;
    const result = await kill(logId);
    if (result?.success) message.success(result.message || t('xxljob.message.kill_success'));
    else message.error(result?.message || t('xxljob.message.action_failed'));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      title={t('xxljob.drawer.log_detail')}
      extra={(
        <Space size={8}>
          <Button
            onClick={() => void readFrom(nextLine, true)}
            loading={loading}
            disabled={ended}
          >
            {t('xxljob.action.load_more')}
          </Button>
          <Button danger disabled={readOnly || busy} onClick={() => void runKill()}>
            {t('xxljob.action.kill')}
          </Button>
        </Space>
      )}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} /> : null}
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: 'var(--gonavi-code-bg, rgba(127,127,127,0.08))',
          borderRadius: 4,
          maxHeight: '60vh',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {content || t('xxljob.empty.log_detail')}
      </pre>
      {ended ? (
        <div style={{ marginTop: 8 }}>
          <Tag color="green">{t('xxljob.value.log_ended')}</Tag>
        </div>
      ) : null}
    </Drawer>
  );
};

// 调度日志面板：执行器 / 任务 / 状态 / 时间范围筛选 + 详情抽屉 + 终止。
export const XxlJobLogPanel: React.FC<Props> = ({ connectionId, isActive }) => {
  const {
    rows, total, loading, error, page, size, reload, setPage, setSize,
    readOnly, busy, jobGroup, jobId, logStatus, range, changeFilter, logKill, fetchLogDetail,
  } = useXxlJobLogs(connectionId, isActive);
  const { allGroups, loadAllGroups } = useXxlJobGroups(connectionId, false);
  const [detailLogId, setDetailLogId] = useState<number | null>(null);
  const [rowsByJob, setRowsByJob] = useState<Record<number, string[]>>({});

  React.useEffect(() => {
    if (isActive) void loadAllGroups();
  }, [isActive, loadAllGroups]);

  const changeGroup = (value?: number) => {
    // 换执行器后原来的任务筛选不再适用，一并清掉，避免出现空结果的错觉。
    changeFilter({ jobGroup: value, jobId: undefined });
  };

  const jobsOfGroup = Object.values(rowsByJob).flat();
  const jobOptions = jobsOfGroup.map((label, index) => ({
    label,
    value: index + 1,
  }));

  return (
    <div className="xxljob-panel">
      <Card size="small" bordered={false}>
        <Space wrap size={8}>
          <Select
            allowClear
            style={{ minWidth: 200 }}
            placeholder={t('xxljob.filter.executor')}
            value={jobGroup}
            onChange={changeGroup}
            options={toGroupOptions(allGroups)}
          />
          {jobOptions.length > 0 ? (
            <Select
              allowClear
              style={{ minWidth: 200 }}
              placeholder={t('xxljob.filter.job')}
              value={jobId}
              onChange={(value?: number) => changeFilter({ jobId: value })}
              options={jobOptions}
            />
          ) : null}
          <Select
            style={{ minWidth: 150 }}
            value={logStatus}
            onChange={(value: number) => changeFilter({ logStatus: value })}
            options={[
              { label: t('xxljob.value.log_all'), value: LOG_STATUS_ALL },
              { label: t('xxljob.value.log_success'), value: 1 },
              { label: t('xxljob.value.log_failed'), value: 2 },
              { label: t('xxljob.value.log_running'), value: 3 },
            ]}
          />
          <DatePicker.RangePicker
            showTime
            format={TIME_FORMAT}
            onChange={(values) => {
              const picked = values ?? [];
              // DatePicker 给出的是 dayjs 对象；只在两端都选中时才产出 filterTime。
              if (picked.length === 2 && picked[0] && picked[1]) {
                changeFilter({
                  range: [
                    picked[0].format(TIME_FORMAT),
                    picked[1].format(TIME_FORMAT),
                  ],
                });
                return;
              }
              changeFilter({ range: null });
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
            {t('xxljob.action.refresh')}
          </Button>
        </Space>
      </Card>

      {error ? (
        <Alert type="error" showIcon message={error} style={{ margin: '8px 0' }} />
      ) : null}

      <Table<XxlJobLog>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        scroll={{ y: 'calc(100vh - 260px)' }}
        pagination={{
          current: page,
          pageSize: size,
          total,
          showSizeChanger: true,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            if (nextSize !== size) setSize(nextSize);
          },
        }}
        locale={{ emptyText: t('xxljob.empty.logs') }}
        columns={[
          { title: t('xxljob.column.id'), dataIndex: 'id', width: 80 },
          { title: t('xxljob.column.job_id'), dataIndex: 'jobId', width: 90 },
          { title: t('xxljob.column.executor_handler'), dataIndex: 'executorHandler', width: 180 },
          { title: t('xxljob.column.executor_address'), dataIndex: 'executorAddress', width: 200 },
          { title: t('xxljob.column.trigger_time'), width: 180, render: (_v: unknown, r: XxlJobLog) => formatXxlJobTime(r.triggerTime) },
          {
            title: t('xxljob.column.trigger_result'),
            width: 110,
            render: (_value: unknown, record: XxlJobLog) => (
              <Tag color={record.triggerCode === 200 ? 'green' : 'red'}>{record.triggerCode}</Tag>
            ),
          },
          { title: t('xxljob.column.handle_time'), width: 180, render: (_v: unknown, r: XxlJobLog) => formatXxlJobTime(r.handleTime) },
          {
            title: t('xxljob.column.handle_result'),
            width: 110,
            render: (_value: unknown, record: XxlJobLog) => {
              if (isXxlJobLogRunning(record)) {
                return <Tag color="processing">{t('xxljob.value.log_running')}</Tag>;
              }
              return (
                <Tag color={record.handleCode === 200 ? 'green' : 'red'}>
                  {record.handleCode || '—'}
                </Tag>
              );
            },
          },
          {
            title: t('xxljob.column.actions'),
            width: 200,
            fixed: 'right',
            render: (_value: unknown, record: XxlJobLog) => (
              <Space size={4}>
                <Button size="small" onClick={() => setDetailLogId(record.id)}>
                  {t('xxljob.action.detail')}
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={readOnly || busy || !isXxlJobLogRunning(record)}
                  onClick={() => {
                    void logKill(record.id).then((result) => {
                      if (result?.success) message.success(result.message || t('xxljob.message.kill_success'));
                      else message.error(result?.message || t('xxljob.message.action_failed'));
                    });
                  }}
                >
                  {t('xxljob.action.kill')}
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <XxlJobLogDetailDrawer
        open={detailLogId != null}
        logId={detailLogId}
        readOnly={readOnly}
        busy={busy}
        fetchDetail={fetchLogDetail}
        kill={logKill}
        onClose={() => setDetailLogId(null)}
      />
    </div>
  );
};

export default XxlJobLogPanel;
