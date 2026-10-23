import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Radio, message } from 'antd';
import { t } from '../../i18n';
import type { XxlJobGroup } from './xxljobModel';
import { xxlJobRpc, type XxlJobGroupMutationPayload } from './xxljobRpc';

type Props = {
  open: boolean;
  editing: XxlJobGroup | null;
  rpcConfig: unknown;
  onSaved: () => void;
  onClose: () => void;
};

type GroupFormValues = {
  appName: string;
  title: string;
  addressType: number;
  addressList?: string;
};

// 执行器新增/编辑表单，字段与官方 group 表单一致：
// AppName（4-64 字符）、名称、注册方式（自动/手动）、手动时的机器地址列表。
export const XxlJobGroupEditorModal: React.FC<Props> = ({
  open, editing, rpcConfig, onSaved, onClose,
}) => {
  const [form] = Form.useForm<GroupFormValues>();
  const [addressType, setAddressType] = useState(0);
  const [saving, setSaving] = useState(false);
  const isEditing = editing != null;

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      appName: editing?.appName ?? '',
      title: editing?.title ?? '',
      addressType: editing?.addressType ?? 0,
      addressList: editing?.addressList ?? '',
    });
    setAddressType(editing?.addressType ?? 0);
  }, [open, editing, form]);

  const submit = async () => {
    if (!rpcConfig) return;
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue(true);
    const payload: XxlJobGroupMutationPayload = {
      id: editing?.id ?? 0,
      appName: values.appName.trim(),
      title: values.title.trim(),
      addressType: values.addressType,
      // 手动注册的地址列表是逗号分隔的机器地址。
      addressList: values.addressType === 0 ? '' : (values.addressList ?? '').trim(),
    };
    setSaving(true);
    try {
      const result = await xxlJobRpc.saveJobGroup(rpcConfig as never, payload);
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
      title={isEditing ? t('xxljob.modal.group_edit_title') : t('xxljob.modal.group_add_title')}
      width={560}
      onCancel={onClose}
      onOk={() => { void submit(); }}
      okText={t('xxljob.action.save')}
      cancelText={t('xxljob.action.cancel')}
      confirmLoading={saving}
      destroyOnHidden
      maskClosable={false}
    >
      <Form form={form} layout="vertical" initialValues={{ addressType: 0 }}>
        <Form.Item
          name="appName"
          label={t('xxljob.field.app_name')}
          extra={t('xxljob.hint.app_name')}
          rules={[
            { required: true, message: t('xxljob.validation.app_name_required') },
            { min: 4, max: 64, message: t('xxljob.validation.app_name_length') },
          ]}
        >
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item
          name="title"
          label={t('xxljob.field.executor_name')}
          rules={[{ required: true, message: t('xxljob.validation.executor_name_required') }]}
        >
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item name="addressType" label={t('xxljob.field.address_type')}>
          <Radio.Group
            onChange={(event) => setAddressType(Number(event.target.value))}
            options={[
              { label: t('xxljob.value.register_auto'), value: 0 },
              { label: t('xxljob.value.register_manual'), value: 1 },
            ]}
          />
        </Form.Item>
        {addressType === 1 ? (
          <Form.Item
            name="addressList"
            label={t('xxljob.field.address_list')}
            extra={t('xxljob.hint.address_list')}
            rules={[{ required: true, message: t('xxljob.validation.address_list_required') }]}
          >
            <Input.TextArea rows={4} maxLength={20000} />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default XxlJobGroupEditorModal;
