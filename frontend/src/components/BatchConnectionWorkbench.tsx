import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Select, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

import Modal from './common/ResizableDraggableModal';
import { useStore } from '../store';
import type { SavedConnection, TabData } from '../types';
import { t } from '../i18n';
import { resolveConnectionIconType } from '../utils/connectionVisual';
import { resolveConnectionHostSummary } from '../utils/tabDisplay';

const { Text, Title } = Typography;

const SELECT_ELLIPSIS_LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const filterOptionByLabel = (input: string, option?: { title?: string; value?: string }) =>
  String(option?.title || option?.value || '').toLowerCase().includes(String(input || '').trim().toLowerCase());

const normalizeConnectionIds = (values: string[] | undefined, connections: SavedConnection[]): string[] => {
  const existingIds = new Set(connections.map((connection) => connection.id));
  const seen = new Set<string>();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => {
      if (!value || !existingIds.has(value) || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

const confirmDestructiveAction = (options: {
  title: string;
  content: string;
  okText?: string;
}): Promise<boolean> => new Promise((resolve) => {
  Modal.confirm({
    ...options,
    okText: options.okText || t('sidebar.action.delete'),
    okButtonProps: { danger: true },
    cancelText: t('sidebar.action.cancel'),
    onOk: () => resolve(true),
    onCancel: () => resolve(false),
  });
});

const BatchConnectionWorkbench: React.FC<{ tab: TabData }> = ({ tab }) => {
  const connections = useStore((state) => state.connections);
  const removeConnection = useStore((state) => state.removeConnection);
  const closeTabsByConnection = useStore((state) => state.closeTabsByConnection);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>(() => (
    normalizeConnectionIds(tab.tableExportInitialConnectionIds, connections)
  ));
  const [deleting, setDeleting] = useState(false);
  const [lastResult, setLastResult] = useState<{ status: 'idle' | 'done' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const appliedInitialConnectionIdsKeyRef = useRef('');

  useEffect(() => {
    setSelectedConnectionIds((current) => {
      const next = normalizeConnectionIds(current, connections);
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [connections]);

  const initialConnectionIdsKey = (tab.tableExportInitialConnectionIds || []).join('\0');
  useEffect(() => {
    if (!initialConnectionIdsKey || appliedInitialConnectionIdsKeyRef.current === initialConnectionIdsKey) {
      return;
    }
    const nextIds = normalizeConnectionIds(tab.tableExportInitialConnectionIds, connections);
    if (nextIds.length === 0) return;
    appliedInitialConnectionIdsKeyRef.current = initialConnectionIdsKey;
    setSelectedConnectionIds((current) => Array.from(new Set([...current, ...nextIds])));
  }, [connections, initialConnectionIdsKey, tab.tableExportInitialConnectionIds]);

  const connectionOptions = useMemo(
    () => [...connections]
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }))
      .map((connection) => {
        const hostSummary = resolveConnectionHostSummary(connection.config);
        const typeLabel = resolveConnectionIconType(connection);
        const title = [connection.name, typeLabel, hostSummary].filter(Boolean).join(' · ');
        return {
          value: connection.id,
          title,
          label: <span style={SELECT_ELLIPSIS_LABEL_STYLE}>{connection.name}</span>,
        };
      }),
    [connections],
  );

  const selectedConnections = useMemo(
    () => selectedConnectionIds
      .map((id) => connections.find((connection) => connection.id === id))
      .filter((connection): connection is SavedConnection => Boolean(connection)),
    [connections, selectedConnectionIds],
  );

  const shellBg = 'var(--gn-bg-panel-2, var(--ant-color-bg-layout, transparent))';
  const dividerColor = 'var(--gn-br-1, var(--ant-color-border-secondary, rgba(15,23,42,0.08)))';
  const headingColor = 'var(--gn-fg-1, var(--ant-color-text, inherit))';
  const secondaryTextColor = 'var(--gn-fg-3, var(--ant-color-text-secondary, inherit))';
  const pillBg = 'var(--gn-bg-active, var(--ant-color-fill-tertiary, transparent))';
  const canDelete = selectedConnections.length > 0 && !deleting;

  const handleDeleteSelectedConnections = async () => {
    const ids = selectedConnections.map((connection) => connection.id);
    if (ids.length === 0 || deleting) return;
    const confirmed = await confirmDestructiveAction({
      title: t('sidebar.modal.confirm_delete_selected_connections.title'),
      content: t('sidebar.modal.confirm_delete_selected_connections.content', { count: ids.length }),
    });
    if (!confirmed) return;

    const backendApp = (window as any).go?.app?.App;
    if (typeof backendApp?.DeleteConnections !== 'function') {
      const errorMessage = t('sidebar.message.delete_connection_backend_unavailable');
      setLastResult({ status: 'error', message: errorMessage });
      message.error(errorMessage);
      return;
    }

    setDeleting(true);
    const hide = message.loading(t('sidebar.message.deleting_selected_connections', { count: ids.length }), 0);
    try {
      await backendApp.DeleteConnections(ids);
      ids.forEach((connectionId) => {
        closeTabsByConnection(connectionId);
        removeConnection(connectionId);
      });
      setSelectedConnectionIds((current) => current.filter((id) => !ids.includes(id)));
      const successMessage = t('sidebar.message.delete_connections_success', { count: ids.length });
      setLastResult({ status: 'done', message: successMessage });
      message.success(successMessage);
    } catch (error: any) {
      const errorMessage = t('sidebar.message.delete_connections_failed', {
        error: error?.message || t('sidebar.message.delete_connection_failed'),
      });
      setLastResult({ status: 'error', message: errorMessage });
      message.error(errorMessage);
    } finally {
      hide();
      setDeleting(false);
    }
  };

  return (
    <div
      data-export-workbench="true"
      data-batch-connection-workbench="true"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: shellBg }}
    >
      <div
        style={{
          padding: '16px 20px 14px',
          borderBottom: `0.5px solid ${dividerColor}`,
          background: 'transparent',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Title level={4} style={{ margin: 0, color: headingColor }}>
            {t('sidebar.action.batch_connections')}
          </Title>
          <div style={{ marginTop: 6, color: secondaryTextColor, fontSize: 13 }}>
            {t('data_export.workbench.intent.batch_connections_delete_description')}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 10px',
            borderRadius: 999,
            background: pillBg,
            color: headingColor,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {`${t('data_export.label.mode')} · ${t('data_export.workbench.mode.batch_connections')}`}
        </span>
      </div>

      <div
        data-export-workbench-layout="true"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)',
          gap: 0,
          alignItems: 'start',
        }}
      >
        <section
          data-export-workbench-config="true"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minHeight: 0,
            maxHeight: '100%',
            overflow: 'auto',
            padding: '16px 18px 20px',
            borderRadius: 0,
            background: 'transparent',
            border: 'none',
            borderRight: `0.5px solid ${dividerColor}`,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: headingColor, marginBottom: 10 }}>
              {t('data_export.workbench.section.config')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', rowGap: 10, columnGap: 12 }}>
              <Text type="secondary">{t('data_export.label.mode')}</Text>
              <Text>{t('data_export.workbench.mode.batch_connections')}</Text>
              <Text type="secondary">{t('data_export.label.selected_connections')}</Text>
              <Text>{selectedConnections.length}</Text>
            </div>
          </div>

          {connections.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              message={t('data_export.workbench.alert.no_saved_connections_title')}
              description={t('data_export.workbench.alert.no_saved_connections_description')}
            />
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <div style={{ fontSize: 12, color: secondaryTextColor }}>{t('data_export.label.connection')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    size="small"
                    type="text"
                    disabled={connectionOptions.length === 0 || deleting}
                    onClick={() => setSelectedConnectionIds(connectionOptions.map((item) => item.value))}
                  >
                    {t('data_export.action.select_all')}
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    disabled={selectedConnectionIds.length === 0 || deleting}
                    onClick={() => setSelectedConnectionIds([])}
                  >
                    {t('data_export.action.clear')}
                  </Button>
                </div>
              </div>
              <Select
                style={{ width: '100%' }}
                mode="multiple"
                value={selectedConnectionIds}
                placeholder={t('data_export.workbench.placeholder.select_connections')}
                options={connectionOptions}
                disabled={deleting}
                showSearch
                optionFilterProp="title"
                filterOption={filterOptionByLabel as any}
                maxTagCount="responsive"
                onChange={(next) => setSelectedConnectionIds(normalizeConnectionIds(next as string[], connections))}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: secondaryTextColor }}>
                {t('data_export.workbench.helper.available_connections', {
                  available: connections.length,
                  selected: selectedConnections.length,
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: secondaryTextColor }}>
            {t('data_export.workbench.helper.batch_connections_delete')}
          </div>
          <div data-batch-connection-danger-actions="true">
            <Button
              danger
              type="primary"
              size="large"
              block
              icon={<DeleteOutlined />}
              data-batch-delete-connections="true"
              disabled={!canDelete}
              loading={deleting}
              onClick={() => { void handleDeleteSelectedConnections(); }}
            >
              {t('sidebar.action.delete_connection_count', { count: selectedConnections.length })}
            </Button>
          </div>
        </section>

        <section
          data-export-workbench-progress-panel="true"
          style={{
            padding: '16px 20px 18px',
            borderRadius: 0,
            background: 'transparent',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            flex: '0 0 auto',
            minHeight: 0,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: headingColor }}>
            {t('data_export.workbench.section.current_task')}
          </div>
          <div data-batch-connection-status={lastResult.status} style={{ color: secondaryTextColor, fontSize: 13 }}>
            {lastResult.message || t('data_export.workbench.empty.batch_connections_idle')}
          </div>
          {selectedConnections.length > 0 ? (
            <Tooltip title={selectedConnections.map((connection) => connection.name).join(', ')}>
              <Text type="secondary">
                {t('data_export.workbench.scope.selected_connections', { count: selectedConnections.length })}
              </Text>
            </Tooltip>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default BatchConnectionWorkbench;
