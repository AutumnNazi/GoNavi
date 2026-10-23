import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  CaretRightOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { t } from '../../i18n';
import {
  TRIGGER_STATUS_RUNNING,
  type XxlJobInfo,
} from './xxljobModel';
import { useXxlJobJobs } from './hooks/useXxlJobJobs';
import { toGroupOptions, useXxlJobGroups } from './hooks/useXxlJobGroups';
import { buildJobColumns } from './xxljobJobColumns';
import { XxlJobJobEditorModal } from './XxlJobJobEditorModal';

type Props = {
  connectionId: string;
  isActive: boolean;
};

type TriggerForm = { executorParam?: string };

// 任务面板：执行器联动下拉、状态/描述筛选、启停 / 执行一次 / 下次触发时间 /
// 新增 / 编辑 / 删除。变更操作全部受只读保护约束。
export const XxlJobJobPanel: React.FC<Props> = ({ connectionId, isActive }) => {
  const {
    rows, total, loading, error, page, size, reload, setPage, setSize,
    readOnly, busy, rpcConfig, jobGroup, triggerStatus, changeJobGroup, changeTriggerStatus,
    changeName, triggerJob, startJobs, stopJobs, nextTriggerTimes, deleteJobs,
  } = useXxlJobJobs(connectionId, isActive);
  const { allGroups, loadAllGroups } = useXxlJobGroups(connectionId, false);
  const [triggerTarget, setTriggerTarget] = useState<XxlJobInfo | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [form] = Form.useForm<TriggerForm>();
  const [nextTimes, setNextTimes] = useState<Record<number, string[]>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<XxlJobInfo | null>(null);

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
    try {
      const values = await form.validateFields();
      const result = await triggerJob(triggerTarget.id, values.executorParam ?? '');
      if (result?.success) {
        message.success(result.message || t('xxljob.message.trigger_success'));
        setTriggerOpen(false);
      } else {
        message.error(result?.message || t('xxljob.message.action_failed'));
      }
    } catch {
      // validateFields 拒绝时 antd 已在字段下方展示错误；这里只需吞掉 rejection。
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

  const openCreate = () => {
    setEditingJob(null);
    setEditorOpen(true);
  };

  const openEdit = (record: XxlJobInfo) => {
    setEditingJob(record);
    setEditorOpen(true);
  };

  const runDelete = async (record: XxlJobInfo) => {
    const result = await deleteJobs([record.id]);
    if (result?.success) {
      message.success(result.message || t('xxljob.message.delete_success'));
    } else {
      message.error(result?.message || t('xxljob.message.action_failed'));
    }
  };

  // 列表刷新后旧的“下次触发时间”计算值会压过 triggerNextTime，随刷新一并清掉。
  React.useEffect(() => {
    setNextTimes({});
  }, [rows]);

  const mutationDisabled = readOnly || busy;
  const readonlyHint = readOnly ? t('xxljob.hint.readonly') : undefined;

  // 行操作：全部图标按钮（Tooltip 承载语义），只保留 Start/Stop 常驻，
  // 触发/下次触发时间/编辑/删除收进 More 菜单；菜单项图标与按钮同源。
  const renderActions = (record: XxlJobInfo) => {
    const moreItems: MenuProps['items'] = [
      {
        key: 'trigger',
        icon: <PlayCircleOutlined />,
        label: t('xxljob.action.trigger'),
        disabled: mutationDisabled,
        onClick: () => openTrigger(record),
      },
      {
        key: 'next_times',
        icon: <ClockCircleOutlined />,
        label: t('xxljob.action.next_times'),
        onClick: () => { void showNextTimes(record); },
      },
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: t('xxljob.action.edit'),
        disabled: mutationDisabled,
        onClick: () => openEdit(record),
      },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t('xxljob.action.delete'),
        danger: true,
        disabled: mutationDisabled,
        onClick: () => { void runDelete(record); },
      },
    ];
    return (
      <Space size={4}>
        <Tooltip title={t('xxljob.action.start')}>
          <Button
            size="small"
            icon={<CaretRightOutlined />}
            aria-label={t('xxljob.action.start')}
            disabled={mutationDisabled || record.triggerStatus === TRIGGER_STATUS_RUNNING}
            onClick={() => void runStart(record.id)}
          />
        </Tooltip>
        <Tooltip title={t('xxljob.action.stop')}>
          <Button
            size="small"
            icon={<PauseOutlined />}
            aria-label={t('xxljob.action.stop')}
            disabled={mutationDisabled || record.triggerStatus !== TRIGGER_STATUS_RUNNING}
            onClick={() => void runStop(record.id)}
          />
        </Tooltip>
        <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
          <Button
            size="small"
            icon={<MoreOutlined />}
            aria-label={t('xxljob.action.more')}
          />
        </Dropdown>
      </Space>
    );
  };

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
          <Input.Search
            allowClear
            style={{ minWidth: 200 }}
            placeholder={t('xxljob.filter.job_desc')}
            onSearch={changeName}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={readOnly}
            onClick={openCreate}
          >
            {t('xxljob.action.add')}
          </Button>
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
        scroll={{ x: 1900, y: 'calc(100vh - 260px)' }}
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
        columns={buildJobColumns({ nextTimes, actions: renderActions })}
      />

      <Modal
        open={triggerOpen}
        title={t('xxljob.modal.trigger_title')}
        onCancel={() => setTriggerOpen(false)}
        onOk={() => { void submitTrigger(); }}
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

      <XxlJobJobEditorModal
        open={editorOpen}
        editing={editingJob}
        groups={toGroupOptions(allGroups)}
        rpcConfig={rpcConfig}
        onSaved={reload}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
};

export default XxlJobJobPanel;
