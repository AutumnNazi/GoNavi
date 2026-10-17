import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  message,
} from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import {
  TRIGGER_STATUS_RUNNING,
  formatXxlJobTime,
  type XxlJobInfo,
} from './xxljobModel';
import { useXxlJobJobs } from './hooks/useXxlJobJobs';
import { toGroupOptions, useXxlJobGroups } from './hooks/useXxlJobGroups';

type Props = {
  connectionId: string;
  isActive: boolean;
};

type TriggerForm = { executorParam?: string };

// 任务面板：执行器联动下拉、状态筛选、启停 / 执行一次 / 下次触发时间。
export const XxlJobJobPanel: React.FC<Props> = ({ connectionId, isActive }) => {
  const {
    rows, total, loading, error, page, size, reload, setPage, setSize,
    readOnly, busy, jobGroup, triggerStatus, changeJobGroup, changeTriggerStatus,
    triggerJob, startJobs, stopJobs, nextTriggerTimes,
  } = useXxlJobJobs(connectionId, isActive);
  const { allGroups, loadAllGroups } = useXxlJobGroups(connectionId, false);
  const [triggerTarget, setTriggerTarget] = useState<XxlJobInfo | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [form] = Form.useForm<TriggerForm>();
  const [nextTimes, setNextTimes] = useState<Record<number, string[]>>({});

  React.useEffect(() => {
    if (isActive) void loadAllGroups();
  }, [isActive, loadAllGroups]);

  const openTrigger = (record: XxlJobInfo) => {
    setTriggerTarget(record);
    form.setFieldsValue({ executorParam: record.executorParam ?? '' });
    setTriggerOpen(true);
  };

  const submitTrigger = async () => {
    if (!triggerTarget) return;
    const values = await form.validateFields();
    const result = await triggerJob(triggerTarget.id, values.executorParam ?? '');
    if (result?.success) {
      message.success(result.message || t('xxljob.message.trigger_success'));
      setTriggerOpen(false);
    } else {
      message.error(result?.message || t('xxljob.message.action_failed'));
    }
  };

  const runStart = async (id: number) => {
    const result = await startJobs([id]);
    if (!result?.success) message.error(result?.message || t('xxljob.message.action_failed'));
  };

  const runStop = async (id: number) => {
    const result = await stopJobs([id]);
    if (!result?.success) message.error(result?.message || t('xxljob.message.action_failed'));
  };

  const showNextTimes = async (record: XxlJobInfo) => {
    if (!record.scheduleType || !record.scheduleConf) {
      message.info(t('xxljob.message.no_schedule'));
      return;
    }
    const times = await nextTriggerTimes(record.scheduleType, record.scheduleConf);
    setNextTimes((prev) => ({ ...prev, [record.id]: times }));
    if (times.length === 0) message.info(t('xxljob.message.no_next_time'));
  };

  const mutationDisabled = readOnly || busy;
  const readonlyHint = readOnly ? t('xxljob.hint.readonly') : undefined;

  return (
    <div className="xxljob-panel">
      <Card size="small" bordered={false}>
        <Space wrap size={8}>
          <Select
            allowClear
            style={{ minWidth: 220 }}
            placeholder={t('xxljob.filter.executor')}
            value={jobGroup}
            onChange={changeJobGroup}
            options={toGroupOptions(allGroups)}
          />
          <Select
            allowClear
            style={{ minWidth: 160 }}
            placeholder={t('xxljob.filter.trigger_status')}
            value={triggerStatus}
            onChange={changeTriggerStatus}
            options={[
              { label: t('xxljob.value.trigger_stopped'), value: 0 },
              { label: t('xxljob.value.trigger_running'), value: 1 },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={reload} loading={loading}>
            {t('xxljob.action.refresh')}
          </Button>
          {readonlyHint ? <span className="xxljob-readonly-hint">{readonlyHint}</span> : null}
        </Space>
      </Card>

      {error ? (
        <Alert type="error" showIcon message={error} style={{ margin: '8px 0' }} />
      ) : null}

      <Table<XxlJobInfo>
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
        locale={{ emptyText: t('xxljob.empty.jobs') }}
        columns={[
          { title: t('xxljob.column.id'), dataIndex: 'id', width: 80 },
          { title: t('xxljob.column.job_name'), dataIndex: 'name', width: 200 },
          { title: t('xxljob.column.executor_handler'), dataIndex: 'executorHandler', width: 200 },
          {
            title: t('xxljob.column.schedule'),
            width: 220,
            render: (_value: unknown, record: XxlJobInfo) => (
              <span>{record.scheduleType || '—'} {record.scheduleConf || ''}</span>
            ),
          },
          {
            title: t('xxljob.column.route_strategy'),
            width: 140,
            render: (_value: unknown, record: XxlJobInfo) => record.executorRouteStrategy || '—',
          },
          {
            title: t('xxljob.column.trigger_status'),
            width: 110,
            render: (_value: unknown, record: XxlJobInfo) => (
              record.triggerStatus === TRIGGER_STATUS_RUNNING
                ? t('xxljob.value.trigger_running')
                : t('xxljob.value.trigger_stopped')
            ),
          },
          { title: t('xxljob.column.last_time'), width: 180, render: (_v: unknown, r: XxlJobInfo) => formatXxlJobTime(r.triggerLastTime) },
          {
            title: t('xxljob.column.next_time'),
            width: 320,
            render: (_value: unknown, record: XxlJobInfo) => {
              const times = nextTimes[record.id];
              if (!times) return formatXxlJobTime(record.triggerNextTime);
              return times.length > 0 ? times.join(' / ') : '—';
            },
          },
          {
            title: t('xxljob.column.actions'),
            width: 260,
            fixed: 'right',
            render: (_value: unknown, record: XxlJobInfo) => (
              <Space size={4}>
                <Tooltip title={t('xxljob.action.trigger')}>
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    disabled={mutationDisabled}
                    onClick={() => openTrigger(record)}
                  />
                </Tooltip>
                <Button
                  size="small"
                  disabled={mutationDisabled || record.triggerStatus === TRIGGER_STATUS_RUNNING}
                  onClick={() => void runStart(record.id)}
                >
                  {t('xxljob.action.start')}
                </Button>
                <Button
                  size="small"
                  disabled={mutationDisabled || record.triggerStatus !== TRIGGER_STATUS_RUNNING}
                  onClick={() => void runStop(record.id)}
                >
                  {t('xxljob.action.stop')}
                </Button>
                <Button size="small" onClick={() => void showNextTimes(record)}>
                  {t('xxljob.action.next_times')}
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={triggerOpen}
        title={t('xxljob.modal.trigger_title')}
        onCancel={() => setTriggerOpen(false)}
        onOk={() => void submitTrigger()}
        okText={t('xxljob.action.confirm')}
        cancelText={t('xxljob.action.cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="executorParam"
            label={t('xxljob.field.executor_param')}
            extra={t('xxljob.hint.executor_param')}
          >
            <Input.TextArea rows={3} placeholder={t('xxljob.placeholder.executor_param')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default XxlJobJobPanel;
