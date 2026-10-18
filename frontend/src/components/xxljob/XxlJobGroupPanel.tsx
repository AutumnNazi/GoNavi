import React, { useState } from 'react';
import { Alert, Button, Card, Input, Popconfirm, Space, Table, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { t } from '../../i18n';
import { formatXxlJobEmptyText, formatXxlJobTime, type XxlJobGroup } from './xxljobModel';
import { useXxlJobGroups } from './hooks/useXxlJobGroups';
import { XxlJobGroupEditorModal } from './XxlJobGroupEditorModal';

type Props = {
  connectionId: string;
  isActive: boolean;
};

// 执行器面板：分页列表 + appname / 名称筛选 + 新增 / 编辑 / 删除。
export const XxlJobGroupPanel: React.FC<Props> = ({ connectionId, isActive }) => {
  const {
    rows, total, loading, error, page, size, reload, setPage, setSize,
    readOnly, busy, rpcConfig, appName, title, setAppName, setTitle, applyFilters, resetFilters,
    saveJobGroup, deleteJobGroups,
  } = useXxlJobGroups(connectionId, isActive);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<XxlJobGroup | null>(null);

  const mutationDisabled = readOnly || busy;
  const readonlyHint = readOnly ? t('xxljob.hint.readonly') : undefined;

  const openCreate = () => {
    setEditingGroup(null);
    setEditorOpen(true);
  };

  const openEdit = (record: XxlJobGroup) => {
    setEditingGroup(record);
    setEditorOpen(true);
  };

  const runDelete = async (record: XxlJobGroup) => {
    const result = await deleteJobGroups([record.id]);
    if (result?.success) {
      message.success(result.message || t('xxljob.message.delete_success'));
    } else {
      message.error(result?.message || t('xxljob.message.action_failed'));
    }
  };

  return (
    <div className="xxljob-panel">
      <Card size="small" bordered={false}>
        <Space wrap size={8}>
          <Input
            allowClear
            style={{ width: 220 }}
            placeholder={t('xxljob.filter.app_name')}
            value={appName}
            onChange={(event) => setAppName(event.target.value)}
            onPressEnter={applyFilters}
          />
          <Input
            allowClear
            style={{ width: 220 }}
            placeholder={t('xxljob.filter.executor_name')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={applyFilters}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>
            {t('xxljob.action.filter')}
          </Button>
          <Button onClick={resetFilters}>{t('xxljob.action.reset')}</Button>
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

      <Table<XxlJobGroup>
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
        locale={{ emptyText: t('xxljob.empty.groups') }}
        columns={[
          { title: t('xxljob.column.id'), dataIndex: 'id', width: 80 },
          { title: t('xxljob.column.app_name'), dataIndex: 'appName', width: 220 },
          {
            title: t('xxljob.column.executor_name'),
            width: 200,
            render: (_value: unknown, record: XxlJobGroup) => record.title || record.appName,
          },
          {
            title: t('xxljob.column.register_mode'),
            width: 130,
            render: (_value: unknown, record: XxlJobGroup) => (
              record.addressType === 0
                ? t('xxljob.value.register_auto')
                : t('xxljob.value.register_manual')
            ),
          },
          {
            title: t('xxljob.column.address'),
            render: (_value: unknown, record: XxlJobGroup) => {
              const nodes = (record.registryList ?? [])
                .map((node) => node?.registryKey)
                .filter((key): key is string => Boolean(key));
              if (nodes.length > 0) return nodes.join(', ');
              return formatXxlJobEmptyText(record.addressList);
            },
          },
          {
            title: t('xxljob.column.update_time'),
            width: 180,
            render: (_value: unknown, record: XxlJobGroup) => formatXxlJobTime(record.updateTime),
          },
          {
            title: t('xxljob.column.actions'),
            width: 120,
            fixed: 'right',
            render: (_value: unknown, record: XxlJobGroup) => (
              <Space size={4}>
                <Tooltip title={t('xxljob.action.edit')}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    aria-label={t('xxljob.action.edit')}
                    disabled={mutationDisabled}
                    onClick={() => openEdit(record)}
                  />
                </Tooltip>
                <Popconfirm
                  title={t('xxljob.confirm.delete_group')}
                  okText={t('xxljob.action.confirm')}
                  cancelText={t('xxljob.action.cancel')}
                  disabled={mutationDisabled}
                  onConfirm={() => { void runDelete(record); }}
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t('xxljob.action.delete')}
                    disabled={mutationDisabled}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <XxlJobGroupEditorModal
        open={editorOpen}
        editing={editingGroup}
        rpcConfig={rpcConfig}
        onSaved={reload}
        onClose={() => setEditorOpen(false)}
      />
    </div>
  );
};

export default XxlJobGroupPanel;
