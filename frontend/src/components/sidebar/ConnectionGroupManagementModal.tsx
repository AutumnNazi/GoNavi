import React, { useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Form, Input, List, Modal, Segmented, Space, Tree, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, FolderAddOutlined, InboxOutlined, SettingOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useStore } from '../../store';
import type { ConnectionSortMode } from '../../types';
import { t } from '../../i18n';
import { buildSidebarRootConnectionToken, buildSidebarRootTagToken, resolveConnectionTagChildOrder, resolveSidebarRootOrderTokens } from '../../store';

type Props = { open: boolean; onClose: () => void };
const UNGROUPED = '__ungrouped__';

const ConnectionGroupManagementModal: React.FC<Props> = ({ open, onClose }) => {
  const connections = useStore((state) => state.connections);
  const tags = useStore((state) => state.connectionTags);
  const rootOrder = useStore((state) => state.sidebarRootOrder);
  const rootSortMode = useStore((state) => state.rootSortMode);
  const setSortMode = useStore((state) => state.setConnectionSortMode);
  const addTag = useStore((state) => state.addConnectionTag);
  const updateTag = useStore((state) => state.updateConnectionTag);
  const removeTag = useStore((state) => state.removeConnectionTag);
  const duplicateTag = useStore((state) => state.duplicateConnectionTag);
  const moveConnections = useStore((state) => state.moveConnectionsToTag);
  const [selectedContainer, setSelectedContainer] = useState<string>(UNGROUPED);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [draggedConnections, setDraggedConnections] = useState<string[]>([]);
  const [nameModal, setNameModal] = useState<{ mode: 'create' | 'rename'; tag?: typeof tags[number] } | null>(null);
  const [nameForm] = Form.useForm<{ name: string }>();

  const connectionById = useMemo(() => new Map(connections.map((connection) => [connection.id, connection])), [connections]);
  const ownerIds = useMemo(() => new Set(tags.flatMap((tag) => tag.connectionIds)), [tags]);
  const sortConnections = (ids: string[], mode: ConnectionSortMode) => {
    const manualIndex = new Map(ids.map((id, index) => [id, index]));
    return [...ids].sort((left, right) => {
      const a = connectionById.get(left); const b = connectionById.get(right);
      if (!a || !b || mode === 'manual') return (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0);
      if (mode === 'createdAt') return (b.createdAt || 0) - (a.createdAt || 0) || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0) || left.localeCompare(right);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0) || left.localeCompare(right);
    });
  };
  const buildTree = (parentId?: string): DataNode[] => {
    const ids = parentId ? resolveConnectionTagChildOrder(parentId, tags) : resolveSidebarRootOrderTokens(rootOrder, tags, connections);
    const tagIds = ids.filter((token) => token.startsWith('tag:')).map((token) => token.slice(4));
    return tags.filter((tag) => (tag.parentTagId || undefined) === parentId && tagIds.includes(tag.id)).map((tag) => ({
      key: tag.id,
      title: <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const ids = draggedConnections; if (!ids.length) return; Modal.confirm({ title: t('connection.sidebar.management.moveTitle'), content: t('connection.sidebar.management.moveContent', { count: ids.length, name: tag.name }), onOk: () => moveConnections(ids, tag.id) }); }}>{tag.name} <Typography.Text type="secondary">({tag.connectionIds.length})</Typography.Text></div>,
      children: buildTree(tag.id),
    }));
  };
  const ungrouped = connections.filter((connection) => !ownerIds.has(connection.id));
  const currentTag = selectedContainer === UNGROUPED ? undefined : tags.find((tag) => tag.id === selectedContainer);
  const currentIds = currentTag ? currentTag.connectionIds : ungrouped.map((connection) => connection.id);
  const currentMode = currentTag?.sortMode || rootSortMode;
  const visibleConnections = sortConnections(currentIds, currentMode);
  const treeData: DataNode[] = [
    { key: UNGROUPED, title: <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const ids = draggedConnections; if (!ids.length) return; Modal.confirm({ title: t('connection.sidebar.management.moveTitle'), content: t('connection.sidebar.management.moveUngroupedContent', { count: ids.length }), onOk: () => moveConnections(ids, null) }); }}><InboxOutlined /> {t('connection.sidebar.management.ungrouped')} ({ungrouped.length})</div> },
    ...buildTree(),
  ];
  const openNameModal = (mode: 'create' | 'rename', tag?: typeof tags[number]) => { setNameModal({ mode, tag }); nameForm.setFieldsValue({ name: tag?.name || '' }); };
  const submitName = async () => { const values = await nameForm.validateFields(); const name = values.name.trim(); if (nameModal?.mode === 'create') addTag({ id: `tag-${globalThis.crypto?.randomUUID?.() || Date.now()}`, name, parentTagId: selectedContainer === UNGROUPED ? undefined : selectedContainer, connectionIds: [] }); else if (nameModal?.tag) updateTag({ ...nameModal.tag, name }); setNameModal(null); };
  const deleteGroup = () => { if (!currentTag) return; Modal.confirm({ title: t('connection.sidebar.management.delete'), content: t('connection.sidebar.management.deleteContent', { name: currentTag.name }), onOk: () => { removeTag(currentTag.id); setSelectedContainer(UNGROUPED); } }); };
  return <>
  <Modal open={open} onCancel={onClose} footer={null} width={960} title={<Space><SettingOutlined />{t('connection.sidebar.management.title')}</Space>} destroyOnClose>
    <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16, minHeight: 520 }}>
      <div style={{ borderRight: '1px solid #eee', paddingRight: 12 }}>
        <Space style={{ marginBottom: 10 }}><Button size="small" icon={<FolderAddOutlined />} onClick={() => openNameModal('create')}>{t('connection.sidebar.management.new')}</Button></Space>
        <Tree treeData={treeData} selectedKeys={[selectedContainer]} defaultExpandAll onSelect={(keys) => { if (keys[0]) { setSelectedContainer(String(keys[0])); setSelectedConnections([]); } }} />
      </div>
      <div>
        <Space wrap style={{ marginBottom: 12 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>{currentTag?.name || t('connection.sidebar.management.ungrouped')}</Typography.Title>
          {currentTag && <><Button size="small" onClick={() => openNameModal('rename', currentTag)}>{t('connection.sidebar.management.rename')}</Button><Button size="small" icon={<CopyOutlined />} onClick={() => { const id = duplicateTag(currentTag.id); if (id) setSelectedContainer(id); }}>{t('connection.sidebar.management.copy')}</Button><Button size="small" danger icon={<DeleteOutlined />} onClick={deleteGroup}>{t('connection.sidebar.management.delete')}</Button></>}
          <Segmented size="small" value={currentMode} options={[{ label: t('connection.sidebar.management.manual'), value: 'manual' }, { label: t('connection.sidebar.management.name'), value: 'name' }, { label: t('connection.sidebar.management.createdAt'), value: 'createdAt' }]} onChange={(value) => setSortMode(currentTag?.id || null, value as ConnectionSortMode)} />
        </Space>
        <Space style={{ marginBottom: 10 }}><Button size="small" onClick={() => setSelectedConnections(visibleConnections)}>{t('connection.sidebar.management.selectAll')}</Button><Button size="small" onClick={() => setSelectedConnections([])}>{t('connection.sidebar.management.clear')}</Button><Typography.Text type="secondary">{t('connection.sidebar.management.selected', { count: selectedConnections.length })}</Typography.Text></Space>
        {visibleConnections.length ? <List bordered size="small" dataSource={visibleConnections} renderItem={(id) => { const connection = connectionById.get(id)!; return <List.Item draggable onDragStart={() => setDraggedConnections(selectedConnections.includes(id) ? selectedConnections : [id])}><Checkbox checked={selectedConnections.includes(id)} onChange={(event) => setSelectedConnections((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))}>{connection.name}</Checkbox><Typography.Text type="secondary">{connection.config.host || ''}</Typography.Text></List.Item>; }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('connection.sidebar.management.empty')} />}
      </div>
    </div>
  </Modal>;
  <Modal open={Boolean(nameModal)} title={nameModal?.mode === 'create' ? t('connection.sidebar.management.new') : t('connection.sidebar.management.rename')} onCancel={() => setNameModal(null)} onOk={() => { void submitName(); }} destroyOnClose>
    <Form form={nameForm} layout="vertical" onFinish={() => { void submitName(); }}>
      <Form.Item name="name" label={t('connection.sidebar.management.nameLabel')} rules={[{ required: true, whitespace: true, message: t('connection.sidebar.management.nameRequired') }]}><Input autoFocus /></Form.Item>
    </Form>
  </Modal>
  </>;
};

export default ConnectionGroupManagementModal;
