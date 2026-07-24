import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox, Form, Input, message, Select, Space } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';

import Modal from '../common/ResizableDraggableModal';
import type { SavedQuery, SavedQueryGroup } from '../../types';
import { t } from '../../i18n';
import { noAutoCapInputProps } from '../../utils/inputAutoCap';
import {
  buildSavedQueryGroupParentOptions,
  buildSavedQueryGroupQueryToken,
  buildSavedQueryGroupToken,
  getSavedQueryGroupOwnerIds,
  normalizeSavedQueryGroups,
} from '../../utils/savedQueryGroups';

type SavedQueryGroupModalProps = {
  open: boolean;
  groups: SavedQueryGroup[];
  savedQueries: SavedQuery[];
  target: SavedQueryGroup | null;
  initialParentGroupId?: string | null;
  modalPanelStyle: React.CSSProperties;
  modalSectionStyle: React.CSSProperties;
  modalScrollSectionStyle: React.CSSProperties;
  renderModalTitle: (icon: React.ReactNode, title: string, description: string) => React.ReactNode;
  onClose: () => void;
  onSave: (group: SavedQueryGroup) => Promise<unknown>;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.reduce<string[]>((result, item) => {
    const id = String(item || '').trim();
    if (!id || seen.has(id)) return result;
    seen.add(id);
    result.push(id);
    return result;
  }, []);
};

const buildChildOrder = (
  group: SavedQueryGroup | null,
  queryIds: string[],
  groups: SavedQueryGroup[],
): string[] => {
  const directChildGroupIds = group?.id
    ? groups
      .filter((candidate) => candidate.parentGroupId === group.id)
      .map((candidate) => candidate.id)
    : [];
  const defaults = [
    ...queryIds.map(buildSavedQueryGroupQueryToken),
    ...directChildGroupIds.map(buildSavedQueryGroupToken),
  ];
  const validTokens = new Set(defaults);
  const seen = new Set<string>();
  return [...(group?.childOrder || []), ...defaults].filter((token) => {
    if (!validTokens.has(token) || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
};

export const SavedQueryGroupModal: React.FC<SavedQueryGroupModalProps> = ({
  open,
  groups,
  savedQueries,
  target,
  initialParentGroupId,
  modalPanelStyle,
  modalSectionStyle,
  modalScrollSectionStyle,
  renderModalTitle,
  onClose,
  onSave,
}) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const normalizedGroups = useMemo(
    () => normalizeSavedQueryGroups(groups, savedQueries.map((query) => query.id)),
    [groups, savedQueries],
  );
  const editingGroup = useMemo(
    () => normalizedGroups.find((group) => group.id === target?.id) || null,
    [normalizedGroups, target?.id],
  );
  const editingGroupId = editingGroup?.id || '';
  const parentOptions = useMemo(
    () => buildSavedQueryGroupParentOptions(normalizedGroups, editingGroupId),
    [editingGroupId, normalizedGroups],
  );
  const queryOwnerIds = useMemo(
    () => getSavedQueryGroupOwnerIds(normalizedGroups),
    [normalizedGroups],
  );
  const selectableQueries = useMemo(
    () => savedQueries.filter((query) => {
      const ownerId = queryOwnerIds.get(query.id);
      return !ownerId || ownerId === editingGroupId;
    }),
    [editingGroupId, queryOwnerIds, savedQueries],
  );

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      name: editingGroup?.name || '',
      parentGroupId: editingGroup?.parentGroupId || initialParentGroupId || undefined,
      queryIds: editingGroup?.queryIds || [],
    });
  }, [editingGroup?.id, form, initialParentGroupId, open]);

  const close = () => {
    if (saving) return;
    form.resetFields();
    onClose();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const queryIds = asStringArray(values.queryIds);
      const nextGroup: SavedQueryGroup = {
        id: editingGroup?.id || '',
        name: String(values.name || '').trim(),
        // Keep an explicit empty parent so the backend can move an edited
        // subgroup back to the root instead of preserving its old parent.
        parentGroupId: String(values.parentGroupId || '').trim(),
        queryIds,
        childOrder: buildChildOrder(editingGroup, queryIds, normalizedGroups),
      };
      setSaving(true);
      await onSave(nextGroup);
      form.resetFields();
      onClose();
    } catch (error) {
      if (error instanceof Error) {
        message.error(t('sidebar.message.saved_query_group_save_failed', { error: error.message }));
      }
    } finally {
      setSaving(false);
    }
  };

  const title = editingGroup
    ? t('sidebar.saved_query_group.edit_title')
    : t('sidebar.saved_query_group.create_title');

  return (
    <Modal
      title={renderModalTitle(
        <FolderOpenOutlined />,
        title,
        t('sidebar.saved_query_group.description'),
      )}
      open={open}
      centered
      width={560}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      styles={{
        content: modalPanelStyle,
        header: { background: 'transparent', borderBottom: 'none', paddingBottom: 10 },
        body: { paddingTop: 8 },
        footer: { background: 'transparent', borderTop: 'none', paddingTop: 12 },
      }}
      onOk={() => void handleSave()}
      onCancel={close}
    >
      <Form form={form} layout="vertical">
        <div style={modalSectionStyle}>
          <Form.Item
            name="name"
            label={t('sidebar.saved_query_group.name_label')}
            rules={[{ required: true, whitespace: true, message: t('sidebar.saved_query_group.name_required') }]}
          >
            <Input {...noAutoCapInputProps} placeholder={t('sidebar.saved_query_group.name_placeholder')} />
          </Form.Item>
          <Form.Item name="parentGroupId" label={t('sidebar.field.parent_group')}>
            <Select
              allowClear
              placeholder={t('sidebar.placeholder.parent_group')}
              options={parentOptions}
            />
          </Form.Item>
          <Form.Item name="queryIds" label={t('sidebar.saved_query_group.select_queries')} style={{ marginBottom: 0 }}>
            <Checkbox.Group style={{ width: '100%' }}>
              <div style={modalScrollSectionStyle}>
                {selectableQueries.length === 0 ? (
                  <div style={{ color: 'var(--gn-text-muted, rgba(127, 127, 127, 0.9))', fontSize: 13, lineHeight: 1.6 }}>
                    {t('sidebar.saved_query_group.empty_queries')}
                  </div>
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {selectableQueries.map((query) => (
                      <Checkbox key={query.id} value={query.id}>
                        {query.name || t('sidebar.tree.untitled_query')}
                        {query.dbName ? ` (${query.dbName})` : ''}
                      </Checkbox>
                    ))}
                  </Space>
                )}
              </div>
            </Checkbox.Group>
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
};
