import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Form, Input, List, Modal, Select, Space, Table, Tooltip, Tree, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, FolderAddOutlined, HolderOutlined, InboxOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { ColumnsType } from 'antd/es/table';
import { useStore } from '../../store';
import type { ConnectionDisplaySortMode, ConnectionTag, SavedConnection } from '../../types';
import { t } from '../../i18n';
import { buildSidebarRootTagToken, resolveConnectionTagChildOrder, resolveSidebarRootOrderTokens } from '../../store';
import { formatSidebarTableTimestamp } from './sidebarHelpers';

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenTagForm: (parentTagId?: string) => void;
  onCreateConnectionInGroup: (tagId: string) => void;
  onEditConnection: (connection: SavedConnection) => void;
};
const UNGROUPED = '__ungrouped__';
const CONNECTION_DRAG_TYPE = 'application/x-gonavi-connection-ids';

export const hasConnectionDragPayload = (event: Pick<React.DragEvent<HTMLElement>, 'dataTransfer'>): boolean =>
  Array.from(event.dataTransfer.types).includes(CONNECTION_DRAG_TYPE);

const getConnectionIdsFromDragEvent = (event: React.DragEvent<HTMLElement>): string[] => {
  if (!hasConnectionDragPayload(event)) return [];
  try {
    const ids = JSON.parse(event.dataTransfer.getData(CONNECTION_DRAG_TYPE));
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
};

export const filterExistingConnectionIds = (
  ids: string[],
  connections: Array<Pick<SavedConnection, 'id'>>,
): string[] => {
  const existingIds = new Set(connections.map((connection) => connection.id));
  return ids.filter((id) => existingIds.has(id));
};

export const findFirstRootTagToken = (tokens: string[]): string | null =>
  tokens.find((token) => token.startsWith('tag:')) || null;

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

const ConnectionGroupManagementModal: React.FC<Props> = ({ open, onClose, onOpenTagForm, onCreateConnectionInGroup, onEditConnection }) => {
  const connections = useStore((state) => state.connections);
  const tags = useStore((state) => state.connectionTags);
  const rootOrder = useStore((state) => state.sidebarRootOrder);
  const rootConnectionSortMode = useStore((state) => state.rootConnectionSortMode);
  const setConnectionSortMode = useStore((state) => state.setConnectionDisplaySortMode);
  const updateTag = useStore((state) => state.updateConnectionTag);
  const removeTagTree = useStore((state) => state.removeConnectionTagTree);
  const removeConnection = useStore((state) => state.removeConnection);
  const moveConnections = useStore((state) => state.moveConnectionsToTag);
  const moveTag = useStore((state) => state.moveConnectionTag);
  const [selectedContainer, setSelectedContainer] = useState<string>(UNGROUPED);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [renameTag, setRenameTag] = useState<ConnectionTag | null>(null);
  const [nameForm] = Form.useForm<{ name: string }>();

  const connectionById = useMemo(() => new Map(connections.map((connection) => [connection.id, connection])), [connections]);
  const selectedExistingConnectionIds = filterExistingConnectionIds(selectedConnections, connections);
  useEffect(() => {
    setSelectedConnections((current) => {
      const next = filterExistingConnectionIds(current, connections);
      return next.length === current.length ? current : next;
    });
  }, [connections]);
  const ownerIds = useMemo(() => new Set(tags.flatMap((tag) => tag.connectionIds)), [tags]);
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const sortConnections = (ids: string[], mode: ConnectionDisplaySortMode) => {
    const manualIndex = new Map(ids.map((id, index) => [id, index]));
    return [...ids].sort((left, right) => {
      const a = connectionById.get(left); const b = connectionById.get(right);
      if (!a || !b) return (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0);
      if (mode === 'createdAt') return (b.createdAt || 0) - (a.createdAt || 0) || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0) || left.localeCompare(right);
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (manualIndex.get(left) || 0) - (manualIndex.get(right) || 0) || left.localeCompare(right);
    });
  };
  const moveDraggedConnections = (connectionIds: string[], targetTagId: string | null) => {
    if (!connectionIds.length) return;
    const owners = new Map<string, ConnectionTag>();
    tags.forEach((tag) => tag.connectionIds.forEach((connectionId) => {
      if (!owners.has(connectionId)) owners.set(connectionId, tag);
    }));
    const targetName = targetTagId
      ? tagById.get(targetTagId)?.name || t('connection.sidebar.management.ungrouped')
      : t('connection.sidebar.management.ungrouped');
    const preview = connectionIds.slice(0, 8);
    Modal.confirm({
      title: t('connection.sidebar.management.moveTitle'),
      content: <div>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          {t('connection.sidebar.management.movePreviewTarget', { count: connectionIds.length, name: targetName })}
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
        {connectionIds.length > preview.length && <Typography.Text type="secondary">
          {t('connection.sidebar.management.movePreviewRemaining', { count: connectionIds.length - preview.length })}
        </Typography.Text>}
      </div>,
      onOk: () => moveConnections(connectionIds, targetTagId),
    });
  };
  const getConnectionDropHandlers = (targetTagId: string | null) => ({
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!hasConnectionDragPayload(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      const ids = getConnectionIdsFromDragEvent(event);
      if (!ids.length) return;
      event.preventDefault();
      event.stopPropagation();
      moveDraggedConnections(ids, targetTagId);
    },
  });
  const isTagDraggable = (tag: ConnectionTag | undefined) => Boolean(tag);
  const buildTree = (parentId?: string): DataNode[] => {
    const ids = parentId ? resolveConnectionTagChildOrder(parentId, tags) : resolveSidebarRootOrderTokens(rootOrder, tags, connections);
    const tagIds = ids.filter((token) => token.startsWith('tag:')).map((token) => token.slice(4));
    return tagIds.reduce<DataNode[]>((nodes, tagId) => {
        const tag = tagById.get(tagId);
        if (!tag || (tag.parentTagId || undefined) !== parentId) return nodes;
        nodes.push({
          key: tag.id,
          title: <div className="connection-group-tree-title" {...getConnectionDropHandlers(tag.id)}><span className="connection-group-tree-name" title={tag.name}>{tag.name}</span><Typography.Text type="secondary">({tag.connectionIds.length})</Typography.Text></div>,
          children: buildTree(tag.id),
        });
        return nodes;
    }, []);
  };
  const ungrouped = connections.filter((connection) => !ownerIds.has(connection.id));
  const currentTag = selectedContainer === UNGROUPED ? undefined : tags.find((tag) => tag.id === selectedContainer);
  const currentIds = currentTag ? currentTag.connectionIds : ungrouped.map((connection) => connection.id);
  const currentMode = currentTag?.connectionSortMode || rootConnectionSortMode;
  const visibleConnections = sortConnections(currentIds, currentMode);
  const treeData: DataNode[] = [{ key: UNGROUPED, title: <div className="connection-group-tree-title" {...getConnectionDropHandlers(null)}><span className="connection-group-tree-name"><InboxOutlined /> {t('connection.sidebar.management.ungrouped')}</span><Typography.Text type="secondary">({ungrouped.length})</Typography.Text></div> }, ...buildTree()];
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
    if (!info.dropToGap || !info.dragNode || !info.node) return;
    const sourceId = String(info.dragNode.key); const targetId = String(info.node.key);
    const source = tagById.get(sourceId);
    if (!source || !isTagDraggable(source)) return;
    // The ungrouped node is synthetic. Dropping a root group directly below it
    // means placing it before the first real root group.
    if (targetId === UNGROUPED && !source.parentTagId && info.dropPosition > 0) {
      const firstRootTagToken = findFirstRootTagToken(
        resolveSidebarRootOrderTokens(rootOrder, tags, connections),
      );
      moveTag(sourceId, null, firstRootTagToken, true);
      return;
    }
    const target = tagById.get(targetId);
    if (!target || source.parentTagId !== target.parentTagId) return;
    moveTag(sourceId, source.parentTagId || null, buildSidebarRootTagToken(targetId), info.dropPosition < 0);
  };
  const visibleConnectionSet = new Set(visibleConnections);
  const connectionColumns: ColumnsType<SavedConnection> = [
    {
      title: t('connection.sidebar.management.connectionName'),
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string) => <Space size={6} style={{ minWidth: 0 }}><HolderOutlined style={{ color: '#999' }} /><Typography.Text ellipsis={{ tooltip: name }} style={{ minWidth: 0 }}>{name}</Typography.Text></Space>,
    },
    {
      title: t('connection.sidebar.management.address'),
      key: 'address',
      width: 180,
      ellipsis: true,
      render: (_, connection) => {
        const host = String(connection.config.host || '');
        const port = Number(connection.config.port);
        const address = host && Number.isFinite(port) && port > 0 ? `${host}:${port}` : host;
        return <Typography.Text ellipsis={{ tooltip: address }}>{address || '-'}</Typography.Text>;
      },
    },
    {
      title: t('connection.sidebar.management.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (createdAt: number | undefined) => createdAt ? formatSidebarTableTimestamp(createdAt) : '-',
    },
    {
      title: t('connection.sidebar.management.actions'),
      key: 'actions',
      width: 80,
      align: 'center',
      render: (_, connection) => <Space size={2}>
        <Tooltip title={t('sidebar.menu.edit_connection')}><Button type="text" size="small" icon={<EditOutlined />} aria-label={t('sidebar.menu.edit_connection')} onClick={() => onEditConnection(connection)} /></Tooltip>
        <Tooltip title={t('connection.sidebar.menu.delete')}><Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={t('connection.sidebar.menu.delete')} onClick={() => window.dispatchEvent(new CustomEvent('gonavi:delete-connection', { detail: { connectionId: connection.id } }))} /></Tooltip>
      </Space>,
    },
  ];

  return <>
    <Modal open={open} onCancel={onClose} footer={null} width={960} title={<Space><SettingOutlined />{t('connection.sidebar.management.title')}</Space>} destroyOnClose>
      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 20, minHeight: 520 }}>
        <div style={{ borderRight: '1px solid var(--gn-border, #eee)', paddingRight: 16, minWidth: 0 }}>
          <Button type="primary" block icon={<FolderAddOutlined />} onClick={() => onOpenTagForm(selectedContainer === UNGROUPED ? undefined : selectedContainer)}>{t('connection.sidebar.management.new')}</Button>
          <Tree className="connection-group-management-tree" treeData={treeData} selectedKeys={[selectedContainer]} defaultExpandAll draggable={{ nodeDraggable: (node) => isTagDraggable(tagById.get(String(node.key))) }} onDrop={handleTreeDrop} onSelect={(keys) => { if (keys[0]) setSelectedContainer(String(keys[0])); }} style={{ marginTop: 12 }} />
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <Typography.Title level={5} ellipsis={{ tooltip: currentTag?.name || t('connection.sidebar.management.ungrouped') }} style={{ margin: 0 }}>{currentTag?.name || t('connection.sidebar.management.ungrouped')}</Typography.Title>
            <Space size={4}>{currentTag && <><Tooltip title={t('sidebar.menu.new_connection')}><Button type="text" icon={<PlusOutlined />} aria-label={t('sidebar.menu.new_connection')} onClick={() => onCreateConnectionInGroup(currentTag.id)} /></Tooltip><Tooltip title={t('connection.sidebar.management.rename')}><Button type="text" icon={<EditOutlined />} aria-label={t('connection.sidebar.management.rename')} onClick={() => { setRenameTag(currentTag); nameForm.setFieldsValue({ name: currentTag.name }); }} /></Tooltip><Tooltip title={t('connection.sidebar.management.delete')}><Button type="text" danger icon={<DeleteOutlined />} aria-label={t('connection.sidebar.management.delete')} onClick={deleteGroup} /></Tooltip></>}<Select size="small" value={currentMode} style={{ width: 130 }} options={[{ label: t('connection.sidebar.management.name'), value: 'name' }, { label: t('connection.sidebar.management.createdAt'), value: 'createdAt' }]} onChange={(value) => setConnectionSortMode(currentTag?.id || null, value as ConnectionDisplaySortMode)} /></Space>
          </div>
          <Typography.Text type="secondary" style={{ marginBottom: 10 }}>{t('connection.sidebar.management.selected', { count: selectedExistingConnectionIds.length })}</Typography.Text>
          {visibleConnections.length ? <Table<SavedConnection>
            bordered
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={visibleConnections.map((id) => connectionById.get(id)).filter((connection): connection is SavedConnection => Boolean(connection))}
            columns={connectionColumns}
            rowSelection={{
              selectedRowKeys: selectedExistingConnectionIds,
              preserveSelectedRowKeys: true,
              columnWidth: 42,
              onChange: (keys) => setSelectedConnections((current) => Array.from(new Set([
                ...current.filter((id) => !visibleConnectionSet.has(id)),
                ...keys.map(String),
              ]))),
            }}
            onRow={(connection) => ({
              draggable: true,
              onDragStart: (event) => {
                const ids = selectedExistingConnectionIds.includes(connection.id) ? selectedExistingConnectionIds : [connection.id];
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(CONNECTION_DRAG_TYPE, JSON.stringify(ids));
              },
            })}
          /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('connection.sidebar.management.empty')} />}
        </div>
      </div>
    </Modal>
    <Modal open={Boolean(renameTag)} title={t('connection.sidebar.management.rename')} onCancel={() => setRenameTag(null)} onOk={() => { void submitRename(); }} destroyOnClose><Form form={nameForm} layout="vertical"><Form.Item name="name" label={t('connection.sidebar.management.nameLabel')} rules={[{ required: true, whitespace: true, message: t('connection.sidebar.management.nameRequired') }]}><Input autoFocus /></Form.Item></Form></Modal>
  </>;
};

export default ConnectionGroupManagementModal;
