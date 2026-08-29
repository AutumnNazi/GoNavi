import React, { useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Form, Input, List, Modal, Select, Space, Tooltip, Tree, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, FolderAddOutlined, HolderOutlined, InboxOutlined, SettingOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { useStore } from '../../store';
import type { ConnectionSortMode, ConnectionTag } from '../../types';
import { t } from '../../i18n';
import { buildSidebarRootTagToken, resolveConnectionTagChildOrder, resolveSidebarRootOrderTokens } from '../../store';

type Props = { open: boolean; onClose: () => void; onOpenTagForm: (parentTagId?: string) => void };
const UNGROUPED = '__ungrouped__';

export const orderConnectionGroupIds = (
  ids: string[],
  tags: ConnectionTag[],
  mode: ConnectionSortMode,
): string[] => {
  if (mode === 'manual') return ids;
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const manualIndex = new Map(ids.map((id, index) => [id, index]));
  return [...ids].sort((left, right) => {
    const a = tagById.get(left); const b = tagById.get(right);
    if (!a || !b) return (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0);
    if (mode === 'createdAt') {
      return (b.createdAt || 0) - (a.createdAt || 0)
        || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0)
        || left.localeCompare(right);
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
      || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0)
      || left.localeCompare(right);
  });
};

const collectTagTree = (rootId: string, tags: ConnectionTag[]) => {
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    tags.forEach((tag) => { if (tag.parentTagId === id) pending.push(tag.id); });
  }
  return tags.filter((tag) => ids.has(tag.id));
};

const ConnectionGroupManagementModal: React.FC<Props> = ({ open, onClose, onOpenTagForm }) => {
  const connections = useStore((state) => state.connections);
  const tags = useStore((state) => state.connectionTags);
  const rootOrder = useStore((state) => state.sidebarRootOrder);
  const rootSortMode = useStore((state) => state.rootSortMode);
  const setSortMode = useStore((state) => state.setConnectionSortMode);
  const updateTag = useStore((state) => state.updateConnectionTag);
  const removeTagTree = useStore((state) => state.removeConnectionTagTree);
  const removeConnection = useStore((state) => state.removeConnection);
  const moveConnections = useStore((state) => state.moveConnectionsToTag);
  const moveTag = useStore((state) => state.moveConnectionTag);
  const [selectedContainer, setSelectedContainer] = useState<string>(UNGROUPED);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [draggedConnections, setDraggedConnections] = useState<string[]>([]);
  const [renameTag, setRenameTag] = useState<ConnectionTag | null>(null);
  const [nameForm] = Form.useForm<{ name: string }>();

  const connectionById = useMemo(() => new Map(connections.map((connection) => [connection.id, connection])), [connections]);
  const ownerIds = useMemo(() => new Set(tags.flatMap((tag) => tag.connectionIds)), [tags]);
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const sortConnections = (ids: string[], mode: ConnectionSortMode) => {
    const manualIndex = new Map(ids.map((id, index) => [id, index]));
    return [...ids].sort((left, right) => {
      const a = connectionById.get(left); const b = connectionById.get(right);
      if (!a || !b || mode === 'manual') return (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0);
      if (mode === 'createdAt') return (b.createdAt || 0) - (a.createdAt || 0) || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0) || left.localeCompare(right);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0) || left.localeCompare(right);
    });
  };
  const moveDraggedConnections = (targetTagId: string | null) => {
    if (!draggedConnections.length) return;
    const owners = new Map<string, ConnectionTag>();
    tags.forEach((tag) => tag.connectionIds.forEach((connectionId) => {
      if (!owners.has(connectionId)) owners.set(connectionId, tag);
    }));
    const targetName = targetTagId
      ? tagById.get(targetTagId)?.name || t('connection.sidebar.management.ungrouped')
      : t('connection.sidebar.management.ungrouped');
    const preview = draggedConnections.slice(0, 8);
    Modal.confirm({
      title: t('connection.sidebar.management.moveTitle'),
      content: <div>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          {t('connection.sidebar.management.movePreviewTarget', { count: draggedConnections.length, name: targetName })}
        </Typography.Paragraph>
        <List
          size="small"
          dataSource={preview}
          renderItem={(connectionId) => {
            const connection = connectionById.get(connectionId);
            const source = owners.get(connectionId)?.name || t('connection.sidebar.management.ungrouped');
            return <List.Item>{t('connection.sidebar.management.movePreviewItem', { name: connection?.name || connectionId, source })}</List.Item>;
          }}
        />
        {draggedConnections.length > preview.length && <Typography.Text type="secondary">
          {t('connection.sidebar.management.movePreviewRemaining', { count: draggedConnections.length - preview.length })}
        </Typography.Text>}
      </div>,
      onOk: () => moveConnections(draggedConnections, targetTagId),
    });
  };
  const isTagDraggable = (tag: ConnectionTag | undefined) => {
    if (!tag) return false;
    const parentMode = tag.parentTagId ? tagById.get(tag.parentTagId)?.sortMode : rootSortMode;
    return parentMode === 'manual';
  };
  const buildTree = (parentId?: string): DataNode[] => {
    const ids = parentId ? resolveConnectionTagChildOrder(parentId, tags) : resolveSidebarRootOrderTokens(rootOrder, tags, connections);
    const tagIds = ids.filter((token) => token.startsWith('tag:')).map((token) => token.slice(4));
    const parentMode = parentId ? tagById.get(parentId)?.sortMode || 'manual' : rootSortMode;
    return orderConnectionGroupIds(tagIds, tags, parentMode)
      .reduce<DataNode[]>((nodes, tagId) => {
        const tag = tagById.get(tagId);
        if (!tag || (tag.parentTagId || undefined) !== parentId) return nodes;
        nodes.push({
          key: tag.id,
          title: <div className="connection-group-tree-title" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveDraggedConnections(tag.id); }}><span className="connection-group-tree-name" title={tag.name}>{tag.name}</span><Typography.Text type="secondary">({tag.connectionIds.length})</Typography.Text></div>,
          children: buildTree(tag.id),
        });
        return nodes;
      }, []);
  };
  const ungrouped = connections.filter((connection) => !ownerIds.has(connection.id));
  const currentTag = selectedContainer === UNGROUPED ? undefined : tags.find((tag) => tag.id === selectedContainer);
  const currentIds = currentTag ? currentTag.connectionIds : ungrouped.map((connection) => connection.id);
  const currentMode = currentTag?.sortMode || rootSortMode;
  const visibleConnections = sortConnections(currentIds, currentMode);
  const allVisibleSelected = visibleConnections.length > 0 && visibleConnections.every((id) => selectedConnections.includes(id));
  const treeData: DataNode[] = [{ key: UNGROUPED, title: <div className="connection-group-tree-title" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveDraggedConnections(null); }}><span className="connection-group-tree-name"><InboxOutlined /> {t('connection.sidebar.management.ungrouped')}</span><Typography.Text type="secondary">({ungrouped.length})</Typography.Text></div> }, ...buildTree()];
  const submitRename = async () => {
    const { name: rawName } = await nameForm.validateFields();
    const name = rawName.trim();
    if (!renameTag) return;
    const duplicate = tags.some((tag) => tag.id !== renameTag.id && tag.parentTagId === renameTag.parentTagId && tag.name.trim().localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
    if (duplicate) { nameForm.setFields([{ name: 'name', errors: [t('connection.sidebar.management.nameDuplicate')] }]); return; }
    updateTag({ ...renameTag, name }); setRenameTag(null);
  };
  const deleteGroup = () => {
    if (!currentTag) return;
    const subtree = collectTagTree(currentTag.id, tags);
    const connectionIds = Array.from(new Set(subtree.flatMap((tag) => tag.connectionIds)));
    Modal.confirm({ title: t('connection.sidebar.management.delete'), content: t('connection.sidebar.management.deleteContent', { name: currentTag.name, groupCount: subtree.length, connectionCount: connectionIds.length }), okButtonProps: { danger: true }, onOk: async () => {
      const backendApp = (window as any).go?.app?.App;
      if (connectionIds.length > 0 && typeof backendApp?.DeleteConnections !== 'function') throw new Error('DeleteConnections unavailable');
      if (connectionIds.length > 0) await backendApp.DeleteConnections(connectionIds);
      connectionIds.forEach(removeConnection);
      removeTagTree(currentTag.id);
      setSelectedConnections((current) => current.filter((id) => !connectionIds.includes(id)));
      setSelectedContainer(UNGROUPED);
    } });
  };
  const handleTreeDrop = (info: any) => {
    if (!info.dropToGap) return;
    const sourceId = String(info.dragNode.key); const targetId = String(info.node.key);
    const source = tagById.get(sourceId); const target = tagById.get(targetId);
    if (!source || !target || source.parentTagId !== target.parentTagId || !isTagDraggable(source)) return;
    moveTag(sourceId, source.parentTagId || null, buildSidebarRootTagToken(targetId), info.dropPosition < 0);
  };

  return <>
    <Modal open={open} onCancel={onClose} footer={null} width={960} title={<Space><SettingOutlined />{t('connection.sidebar.management.title')}</Space>} destroyOnClose>
      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 20, minHeight: 520 }}>
        <div style={{ borderRight: '1px solid var(--gn-border, #eee)', paddingRight: 16, minWidth: 0 }}>
          <Button type="primary" block icon={<FolderAddOutlined />} onClick={() => { onClose(); onOpenTagForm(selectedContainer === UNGROUPED ? undefined : selectedContainer); }}>{t('connection.sidebar.management.new')}</Button>
          <Tree className="connection-group-management-tree" treeData={treeData} selectedKeys={[selectedContainer]} defaultExpandAll draggable={{ nodeDraggable: (node) => isTagDraggable(tagById.get(String(node.key))) }} onDrop={handleTreeDrop} onSelect={(keys) => { if (keys[0]) setSelectedContainer(String(keys[0])); }} style={{ marginTop: 12 }} />
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <Typography.Title level={5} ellipsis={{ tooltip: currentTag?.name || t('connection.sidebar.management.ungrouped') }} style={{ margin: 0 }}>{currentTag?.name || t('connection.sidebar.management.ungrouped')}</Typography.Title>
            <Space size={4}>{currentTag && <><Tooltip title={t('connection.sidebar.management.rename')}><Button type="text" icon={<EditOutlined />} aria-label={t('connection.sidebar.management.rename')} onClick={() => { setRenameTag(currentTag); nameForm.setFieldsValue({ name: currentTag.name }); }} /></Tooltip><Tooltip title={t('connection.sidebar.management.delete')}><Button type="text" danger icon={<DeleteOutlined />} aria-label={t('connection.sidebar.management.delete')} onClick={deleteGroup} /></Tooltip></>}<Select size="small" value={currentMode} style={{ width: 130 }} options={[{ label: t('connection.sidebar.management.manual'), value: 'manual' }, { label: t('connection.sidebar.management.name'), value: 'name' }, { label: t('connection.sidebar.management.createdAt'), value: 'createdAt' }]} onChange={(value) => setSortMode(currentTag?.id || null, value as ConnectionSortMode)} /></Space>
          </div>
          <Space style={{ marginBottom: 10 }}><Button size="small" onClick={() => setSelectedConnections((current) => allVisibleSelected ? current.filter((id) => !visibleConnections.includes(id)) : Array.from(new Set([...current, ...visibleConnections])))}>{allVisibleSelected ? t('connection.sidebar.management.clear') : t('connection.sidebar.management.selectAll')}</Button><Typography.Text type="secondary">{t('connection.sidebar.management.selected', { count: selectedConnections.length })}</Typography.Text></Space>
          {visibleConnections.length ? <List bordered size="small" dataSource={visibleConnections} renderItem={(id) => { const connection = connectionById.get(id)!; return <List.Item draggable onDragStart={() => setDraggedConnections(selectedConnections.includes(id) ? selectedConnections : [id])} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(120px, 36%)', gap: 12 }}><Checkbox checked={selectedConnections.includes(id)} onChange={(event) => setSelectedConnections((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))}><HolderOutlined style={{ color: '#999', marginRight: 6 }} />{connection.name}</Checkbox><Typography.Text ellipsis type="secondary">{connection.config.host || ''}</Typography.Text></List.Item>; }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('connection.sidebar.management.empty')} />}
        </div>
      </div>
    </Modal>
    <Modal open={Boolean(renameTag)} title={t('connection.sidebar.management.rename')} onCancel={() => setRenameTag(null)} onOk={() => { void submitRename(); }} destroyOnClose><Form form={nameForm} layout="vertical"><Form.Item name="name" label={t('connection.sidebar.management.nameLabel')} rules={[{ required: true, whitespace: true, message: t('connection.sidebar.management.nameRequired') }]}><Input autoFocus /></Form.Item></Form></Modal>
  </>;
};

export default ConnectionGroupManagementModal;
