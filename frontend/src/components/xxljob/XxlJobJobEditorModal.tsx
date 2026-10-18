import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Divider, Form, Input, InputNumber, Modal, Select, Switch, message } from 'antd';
import { t } from '../../i18n';
import type { XxlJobGroupOption } from './hooks/useXxlJobGroups';
import type { XxlJobInfo } from './xxljobModel';
import {
  BLOCK_STRATEGIES,
  GLUE_MONACO_LANGUAGE,
  GLUE_TYPES,
  MISFIRE_STRATEGIES,
  ROUTE_STRATEGIES,
  SCHEDULE_CONF_HINT_KEY,
  SCHEDULE_TYPES,
  buildJobFormValues,
  buildJobMutationPayload,
  emptyJobFormValues,
  enumOptions,
  validateScheduleConf,
  type JobFormValues,
} from './xxljobJobEditor';
import { xxlJobRpc, type XxlJobJobMutationPayload } from './xxljobRpc';
import { XxlJobGlueEditor } from './XxlJobGlueEditor';

type Props = {
  open: boolean;
  editing: XxlJobInfo | null;
  groups: XxlJobGroupOption[];
  rpcConfig: unknown;
  onSaved: () => void;
  onClose: () => void;
};

type SaveResult = { success: boolean; message?: string } | null;

// 任务新增/编辑表单。字段与官方 add/update 表单一一对应，按
// 基础配置 / 调度配置 / 任务配置 / 高级配置四段排布。
export const XxlJobJobEditorModal: React.FC<Props> = ({
  open, editing, groups, rpcConfig, onSaved, onClose,
}) => {
  const [form] = Form.useForm<JobFormValues>();
  const [glueType, setGlueType] = useState('BEAN');
  const [scheduleType, setScheduleType] = useState('CRON');
  const [saving, setSaving] = useState(false);
  const isEditing = editing != null;

  useEffect(() => {
    if (!open) return;
    const values = editing ? buildJobFormValues(editing) : emptyJobFormValues(groups[0]?.value);
    form.setFieldsValue(values);
    setGlueType(values.glueType);
    setScheduleType(values.scheduleType);
  }, [open, editing, form, groups]);

  const glueLanguage = useMemo(() => GLUE_MONACO_LANGUAGE[glueType] ?? 'java', [glueType]);

  // CRON 实时验证走官方 nextTriggerTime：能算出触发时间即合法。
  const validateCron = async (_rule: unknown, conf: string | undefined) => {
    const problem = validateScheduleConf(scheduleType, conf);
    if (problem) throw new Error(t(problem));
    if (scheduleType !== 'CRON' || !rpcConfig || !(conf ?? '').trim()) return;
    const result = await xxlJobRpc.nextTriggerTimes(rpcConfig as never, 'CRON', (conf ?? '').trim());
    if (!result?.success || !Array.isArray(result.data)) {
      throw new Error(result?.message || t('xxljob.validation.schedule_conf_cron_invalid'));
    }
  };

  const submit = async () => {
    if (!rpcConfig) return;
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue(true);
    const payload: XxlJobJobMutationPayload = buildJobMutationPayload(values, editing?.id ?? 0);
    setSaving(true);
    try {
      const result = await xxlJobRpc.saveJob(rpcConfig as never, payload) as SaveResult;
      if (result?.success) {
        message.success(result.message || t('xxljob.message.save_success'));
        onSaved();
        onClose();
      } else {
        message.error(result?.message || t('xxljob.message.action_failed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEditing ? t('xxljob.modal.job_edit_title') : t('xxljob.modal.job_add_title')}
      width={720}
      onCancel={onClose}
      onOk={() => { void submit(); }}
      okText={t('xxljob.action.save')}
      cancelText={t('xxljob.action.cancel')}
      confirmLoading={saving}
      destroyOnHidden
      maskClosable={false}
    >
      <Form form={form} layout="vertical" initialValues={emptyJobFormValues()}>
        <Divider plain orientationMargin={0}>{t('xxljob.section.basic')}</Divider>
        <div className="xxljob-form-grid">
          <Form.Item
            name="jobGroup"
            label={t('xxljob.field.job_group')}
            rules={[{ required: true, message: t('xxljob.validation.job_group_required') }]}
          >
            <Select options={groups.map((g) => ({ label: g.label, value: g.value }))} />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('xxljob.field.name')}
            rules={[{ required: true, message: t('xxljob.validation.name_required') }]}
          >
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item
            name="author"
            label={t('xxljob.field.author')}
            rules={[{ required: true, message: t('xxljob.validation.author_required') }]}
          >
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item
            name="alarmEmail"
            label={t('xxljob.field.alarm_email')}
            rules={[{ type: 'email', message: t('xxljob.validation.alarm_email_invalid') }]}
          >
            <Input maxLength={100} placeholder={t('xxljob.placeholder.alarm_email')} />
          </Form.Item>
        </div>

        <Divider plain orientationMargin={0}>{t('xxljob.section.schedule')}</Divider>
        <div className="xxljob-form-grid">
          <Form.Item name="scheduleType" label={t('xxljob.field.schedule_type')} rules={[{ required: true }]}>
            <Select
              options={enumOptions(SCHEDULE_TYPES, 'schedule_type')}
              onChange={(next) => setScheduleType(String(next))}
            />
          </Form.Item>
          {scheduleType !== 'NONE' ? (
            <Form.Item
              name="scheduleConf"
              label={t('xxljob.field.schedule_conf')}
              extra={t(SCHEDULE_CONF_HINT_KEY[scheduleType] ?? 'xxljob.hint.schedule_conf_cron')}
              rules={[{ validator: validateCron }]}
            >
              <Input maxLength={scheduleType === 'CRON' ? 128 : 10} />
            </Form.Item>
          ) : null}
          <Form.Item name="misfireStrategy" label={t('xxljob.field.misfire_strategy')}>
            <Select options={enumOptions(MISFIRE_STRATEGIES, 'misfire')} />
          </Form.Item>
          <Form.Item
            name="triggerStatus"
            label={t('xxljob.field.trigger_status')}
            valuePropName="checked"
            getValueFromEvent={(checked: boolean) => (checked ? 1 : 0)}
            getValueProps={(value) => ({ checked: value === 1 })}
          >
            <Switch />
          </Form.Item>
        </div>

        <Divider plain orientationMargin={0}>{t('xxljob.section.job')}</Divider>
        <div className="xxljob-form-grid">
          <Form.Item name="glueType" label={t('xxljob.field.glue_type')} rules={[{ required: true }]}>
            <Select options={enumOptions(GLUE_TYPES, 'glue')} onChange={(next) => setGlueType(String(next))} />
          </Form.Item>
          {glueType === 'BEAN' ? (
            <Form.Item
              name="executorHandler"
              label={t('xxljob.field.executor_handler')}
              rules={[{ required: true, message: t('xxljob.validation.executor_handler_required') }]}
            >
              <Input maxLength={100} />
            </Form.Item>
          ) : null}
        </div>
        <Form.Item name="executorParam" label={t('xxljob.field.executor_param')}>
          <Input.TextArea rows={2} maxLength={2048} />
        </Form.Item>
        {glueType !== 'BEAN' ? (
          <Form.Item
            name="glueSource"
            label={t('xxljob.field.glue_source')}
            extra={t('xxljob.hint.glue_source')}
            rules={[{ required: true, message: t('xxljob.validation.glue_source_required') }]}
          >
            <XxlJobGlueEditor language={glueLanguage} value={form.getFieldValue('glueSource') ?? ''} onChange={(next) => form.setFieldValue('glueSource', next)} />
          </Form.Item>
        ) : null}

        <Divider plain orientationMargin={0}>{t('xxljob.section.advanced')}</Divider>
        <div className="xxljob-form-grid">
          <Form.Item name="executorRouteStrategy" label={t('xxljob.field.route_strategy')}>
            <Select options={enumOptions(ROUTE_STRATEGIES, 'route')} />
          </Form.Item>
          <Form.Item name="childJobId" label={t('xxljob.field.child_job_id')}>
            <Input maxLength={100} placeholder={t('xxljob.placeholder.child_job_id')} />
          </Form.Item>
          <Form.Item name="executorBlockStrategy" label={t('xxljob.field.block_strategy')}>
            <Select options={enumOptions(BLOCK_STRATEGIES, 'block')} />
          </Form.Item>
          <Form.Item name="executorTimeout" label={t('xxljob.field.timeout')}>
            <InputNumber min={-1} max={999999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="executorFailRetryCount" label={t('xxljob.field.fail_retry_count')}>
            <InputNumber min={-1} max={99} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Alert type="info" showIcon message={t('xxljob.hint.timeout_retry_default')} style={{ marginBottom: 8 }} />
      </Form>
    </Modal>
  );
};

export default XxlJobJobEditorModal;
