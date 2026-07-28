import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import RedisResizableDivider from './RedisResizableDivider';
import { buildRedisWorkbenchTheme } from './redisViewerWorkbenchTheme';
import { useStore } from '../store';
import {
  isMacLikePlatform,
  normalizeBlurForPlatform,
  normalizeOpacityForPlatform,
  resolveAppearanceValues,
} from '../utils/appearance';
import { buildRpcConnectionConfig } from '../utils/connectionRpcConfig';
import {
  isConnectionDataEditRestricted,
  isConnectionStructureEditRestricted,
} from '../utils/connectionReadOnly';
import { t, type I18nParams } from '../i18n';
import { useOptionalI18n } from '../i18n/provider';
import { noAutoCapInputProps } from '../utils/inputAutoCap';
import { parseNacosServiceName } from './nacosServiceName';

type ServicePage = {
  count: number;
  serviceNames: string[];
  pageNo?: number;
  pageSize?: number;
};

type NacosInstance = {
  instanceId?: string;
  ip: string;
  port: number;
  weight?: number;
  healthy: boolean;
  enabled: boolean;
  ephemeral: boolean;
  clusterName?: string;
  serviceName?: string;
  metadata?: Record<string, string>;
};

type InstanceList = {
  name?: string;
  groupName?: string;
  hosts: NacosInstance[];
};

type NacosServiceViewerProps = {
  connectionId: string;
  namespaceId: string;
  namespaceName?: string;
  initialGroup?: string;
};

type NacosServiceRow = {
  rawName: string;
  serviceName: string;
  groupName: string;
};

const NACOS_SERVICES_CHANGED_EVENT = 'gonavi:nacos-services-changed';

const NacosServiceViewer: React.FC<NacosServiceViewerProps> = ({
  connectionId,
  namespaceId,
  namespaceName,
  initialGroup,
}) => {
  const connections = useStore((state) => state.connections);
  const appTheme = useStore((state) => state.theme);
  const appearance = useStore((state) => state.appearance);
  const i18n = useOptionalI18n();
  const i18nLanguage = i18n?.language;
  const tr = useCallback(
    (key: string, params?: I18nParams) => t(key, params, i18nLanguage),
    [i18nLanguage],
  );

  const darkMode = appTheme === 'dark';
  const isV2Ui = appearance.uiVersion === 'v2';
  const resolvedAppearance = resolveAppearanceValues(appearance);
  const opacity = normalizeOpacityForPlatform(resolvedAppearance.opacity);
  const blur = normalizeBlurForPlatform(resolvedAppearance.blur);
  const workbenchTheme = useMemo(
    () => buildRedisWorkbenchTheme({
      darkMode,
      opacity,
      blur,
      disableBackdropFilter: isMacLikePlatform(),
    }),
    [blur, darkMode, opacity, appearance.uiVersion],
  );
  // v1 keeps raised cards; v2 is flat (same as Redis gn-v2-redis-workbench CSS).
  const workbenchCardStyle = useMemo(() => (
    isV2Ui
      ? {
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          borderRadius: 0,
        }
      : {
          background: workbenchTheme.panelBg,
          border: workbenchTheme.panelBorder,
          boxShadow: `${workbenchTheme.panelInset}, ${workbenchTheme.shadow}`,
          borderRadius: 12,
          backdropFilter: workbenchTheme.backdropFilter,
          WebkitBackdropFilter: workbenchTheme.backdropFilter,
        }
  ), [isV2Ui, workbenchTheme]);

  const connection = connections.find((item) => item.id === connectionId);
  const dataEditRestricted = isConnectionDataEditRestricted(connection?.config);
  const structureRestricted = isConnectionStructureEditRestricted(connection?.config)
    || dataEditRestricted
    || !!connection?.config?.readOnly;

  const rpcConfig = useMemo(() => {
    if (!connection?.config) return null;
    return buildRpcConnectionConfig(connection.config as any);
  }, [connection?.config]);

  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [serviceTotal, setServiceTotal] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize] = useState(50);
  const [groupFilter, setGroupFilter] = useState(() => String(initialGroup || '').trim());
  const [selectedServiceRaw, setSelectedServiceRaw] = useState<string | null>(null);
  const [instances, setInstances] = useState<NacosInstance[]>([]);

  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [serviceForm] = Form.useForm();
  const [instanceModalOpen, setInstanceModalOpen] = useState(false);
  const [instanceForm] = Form.useForm();
  const [editingInstance, setEditingInstance] = useState<NacosInstance | null>(null);
  // Left service list pane width; drag divider to adjust (same pattern as Redis).
  const [leftPanelWidth, setLeftPanelWidth] = useState<number | string>('38%');
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const instanceRequestIdRef = useRef(0);

  const selectedParsed = useMemo(
    () => (selectedServiceRaw ? parseNacosServiceName(selectedServiceRaw) : null),
    [selectedServiceRaw],
  );
  const serviceRows = useMemo<NacosServiceRow[]>(
    () => serviceNames.map((rawName) => ({ rawName, ...parseNacosServiceName(rawName) })),
    [serviceNames],
  );
  const notifyServiceGroupsChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent(NACOS_SERVICES_CHANGED_EVENT, {
      detail: {
        connectionId,
        namespaceId: namespaceId || '',
      },
    }));
  }, [connectionId, namespaceId]);

  const loadServices = useCallback(
    async (page = 1) => {
      if (!rpcConfig) return;
      setLoadingServices(true);
      try {
        const res = await (window as any).go.app.App.NacosListServices(rpcConfig, {
          namespaceId: namespaceId || '',
          groupName: groupFilter.trim(),
          pageNo: page,
          pageSize,
        });
        if (!res?.success) {
          message.error(res?.message || 'list services failed');
          return;
        }
        const pageData = (res.data || {}) as ServicePage;
        const names = Array.isArray(pageData.serviceNames) ? pageData.serviceNames : [];
        setServiceNames(names);
        setServiceTotal(Number(pageData.count) || names.length);
        setPageNo(Number(pageData.pageNo) || page);
        if (selectedServiceRaw && !names.includes(selectedServiceRaw)) {
          instanceRequestIdRef.current += 1;
          setSelectedServiceRaw(null);
          setInstances([]);
          setLoadingInstances(false);
        }
      } catch (error: any) {
        message.error(error?.message || String(error));
      } finally {
        setLoadingServices(false);
      }
    },
    [rpcConfig, namespaceId, groupFilter, pageSize, selectedServiceRaw],
  );

  const loadInstances = useCallback(
    async (rawServiceName: string) => {
      if (!rpcConfig) return;
      const parsed = parseNacosServiceName(rawServiceName);
      const requestId = ++instanceRequestIdRef.current;
      setLoadingInstances(true);
      try {
        const res = await (window as any).go.app.App.NacosListInstances(rpcConfig, {
          namespaceId: namespaceId || '',
          serviceName: parsed.serviceName,
          groupName: parsed.groupName,
        });
        if (requestId !== instanceRequestIdRef.current) return;
        if (!res?.success) {
          message.error(res?.message || 'list instances failed');
          return;
        }
        const list = (res.data || {}) as InstanceList;
        setInstances(Array.isArray(list.hosts) ? list.hosts : []);
      } catch (error: any) {
        if (requestId !== instanceRequestIdRef.current) return;
        message.error(error?.message || String(error));
      } finally {
        if (requestId === instanceRequestIdRef.current) {
          setLoadingInstances(false);
        }
      }
    },
    [rpcConfig, namespaceId],
  );

  useEffect(() => {
    instanceRequestIdRef.current += 1;
    setSelectedServiceRaw(null);
    setInstances([]);
    setLoadingInstances(false);
    void loadServices(1);
    return () => {
      instanceRequestIdRef.current += 1;
    };
  }, [connectionId, namespaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateService = async () => {
    if (!rpcConfig || structureRestricted) return;
    try {
      const values = await serviceForm.validateFields();
      const res = await (window as any).go.app.App.NacosCreateService(rpcConfig, {
        namespaceId: namespaceId || '',
        serviceName: String(values.serviceName || '').trim(),
        groupName: String(values.groupName || 'DEFAULT_GROUP').trim() || 'DEFAULT_GROUP',
        protectThreshold: Number(values.protectThreshold || 0),
      });
      if (!res?.success) {
        message.error(res?.message || 'create service failed');
        return;
      }
      message.success(tr('nacos_service.message.service_create_success'));
      notifyServiceGroupsChanged();
      setServiceModalOpen(false);
      serviceForm.resetFields();
      await loadServices(1);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || String(error));
    }
  };

  const handleDeleteService = async (raw: string) => {
    if (!rpcConfig || structureRestricted) return;
    const parsed = parseNacosServiceName(raw);
    try {
      const res = await (window as any).go.app.App.NacosDeleteService(
        rpcConfig,
        namespaceId || '',
        parsed.serviceName,
        parsed.groupName,
      );
      if (!res?.success) {
        message.error(res?.message || 'delete service failed');
        return;
      }
      message.success(tr('nacos_service.message.service_delete_success'));
      notifyServiceGroupsChanged();
      if (selectedServiceRaw === raw) {
        instanceRequestIdRef.current += 1;
        setSelectedServiceRaw(null);
        setInstances([]);
        setLoadingInstances(false);
      }
      await loadServices(pageNo);
    } catch (error: any) {
      message.error(error?.message || String(error));
    }
  };

  const openRegisterInstance = () => {
    if (!selectedParsed) return;
    setEditingInstance(null);
    instanceForm.setFieldsValue({
      serviceName: selectedParsed.serviceName,
      groupName: selectedParsed.groupName,
      ip: '',
      port: 8080,
      weight: 1,
      clusterName: 'DEFAULT',
      enabled: true,
      ephemeral: true,
      healthy: true,
    });
    setInstanceModalOpen(true);
  };

  const openEditInstance = (inst: NacosInstance) => {
    if (!selectedParsed) return;
    setEditingInstance(inst);
    instanceForm.setFieldsValue({
      serviceName: selectedParsed.serviceName,
      groupName: selectedParsed.groupName,
      ip: inst.ip,
      port: inst.port,
      weight: inst.weight ?? 1,
      clusterName: inst.clusterName || 'DEFAULT',
      enabled: inst.enabled,
      ephemeral: inst.ephemeral,
      healthy: inst.healthy,
    });
    setInstanceModalOpen(true);
  };

  const handleSaveInstance = async () => {
    if (!rpcConfig || dataEditRestricted || !selectedParsed) return;
    try {
      const values = await instanceForm.validateFields();
      const payload = {
        namespaceId: namespaceId || '',
        serviceName: String(values.serviceName || selectedParsed.serviceName).trim(),
        groupName: String(values.groupName || selectedParsed.groupName).trim(),
        ip: String(values.ip || '').trim(),
        port: Number(values.port),
        weight: Number(values.weight || 1),
        clusterName: String(values.clusterName || 'DEFAULT').trim(),
        enabled: !!values.enabled,
        ephemeral: !!values.ephemeral,
        healthy: !!values.healthy,
      };
      const res = editingInstance
        ? await (window as any).go.app.App.NacosUpdateInstance(rpcConfig, payload)
        : await (window as any).go.app.App.NacosRegisterInstance(rpcConfig, payload);
      if (!res?.success) {
        message.error(res?.message || 'save instance failed');
        return;
      }
      message.success(
        editingInstance
          ? tr('nacos_service.message.instance_update_success')
          : tr('nacos_service.message.instance_register_success'),
      );
      setInstanceModalOpen(false);
      if (selectedServiceRaw) await loadInstances(selectedServiceRaw);
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.message || String(error));
    }
  };

  const handleDeregister = async (inst: NacosInstance) => {
    if (!rpcConfig || dataEditRestricted || !selectedParsed) return;
    try {
      const res = await (window as any).go.app.App.NacosDeregisterInstance(rpcConfig, {
        namespaceId: namespaceId || '',
        serviceName: selectedParsed.serviceName,
        groupName: selectedParsed.groupName,
        ip: inst.ip,
        port: inst.port,
        clusterName: inst.clusterName || '',
        ephemeral: inst.ephemeral,
      });
      if (!res?.success) {
        message.error(res?.message || 'deregister failed');
        return;
      }
      message.success(tr('nacos_service.message.instance_deregister_success'));
      if (selectedServiceRaw) await loadInstances(selectedServiceRaw);
    } catch (error: any) {
      message.error(error?.message || String(error));
    }
  };

  const handleToggleHealth = async (inst: NacosInstance, healthy: boolean) => {
    if (!rpcConfig || dataEditRestricted || !selectedParsed) return;
    try {
      const res = await (window as any).go.app.App.NacosUpdateInstanceHealth(rpcConfig, {
        namespaceId: namespaceId || '',
        serviceName: selectedParsed.serviceName,
        groupName: selectedParsed.groupName,
        ip: inst.ip,
        port: inst.port,
        clusterName: inst.clusterName || '',
        healthy,
      });
      if (!res?.success) {
        message.error(res?.message || 'update health failed');
        return;
      }
      message.success(tr('nacos_service.message.instance_health_success'));
      if (selectedServiceRaw) await loadInstances(selectedServiceRaw);
    } catch (error: any) {
      message.error(error?.message || String(error));
    }
  };

  const namespaceLabel = namespaceName || (namespaceId ? namespaceId : 'public');

  return (
    <div
      className={isV2Ui ? 'gn-v2-nacos-workbench' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: isV2Ui ? 0 : 12,
        gap: isV2Ui ? 0 : 12,
        boxSizing: 'border-box',
        background: isV2Ui ? undefined : workbenchTheme.appBg,
        color: workbenchTheme.textPrimary,
      }}
    >
      <div
        className={isV2Ui ? 'gn-v2-nacos-split' : undefined}
        style={{
          display: isV2Ui ? undefined : 'flex',
          minHeight: 0,
          flex: 1,
          overflow: 'hidden',
          ...(isV2Ui
            ? {
                ['--gn-nacos-sidebar-width' as string]:
                  typeof leftPanelWidth === 'number' ? `${leftPanelWidth}px` : leftPanelWidth,
              }
            : {}),
        }}
      >
        <div
          ref={leftPanelRef}
          className={isV2Ui ? 'gn-v2-nacos-list-pane' : undefined}
          style={
            isV2Ui
              ? { minHeight: 0, overflow: 'hidden' }
              : {
                  ...workbenchCardStyle,
                  width: leftPanelWidth,
                  minWidth: 260,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0,
                  overflow: 'hidden',
                }
          }
        >
          <div
            className={isV2Ui ? 'gn-v2-nacos-pane-header' : undefined}
            style={isV2Ui ? undefined : { padding: 8, marginBottom: 8 }}
          >
            <Space wrap size={[8, 8]}>
              <Tag color="cyan">{namespaceLabel}</Tag>
              <Input
                allowClear
                {...noAutoCapInputProps}
                style={{ width: 160 }}
                placeholder={tr('nacos_service.field.group')}
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                onPressEnter={() => void loadServices(1)}
              />
              <Button icon={<ReloadOutlined />} loading={loadingServices} onClick={() => void loadServices(1)}>
                {tr('nacos_viewer.action.refresh')}
              </Button>
              <Button
                icon={<PlusOutlined />}
                disabled={structureRestricted}
                onClick={() => {
                  serviceForm.setFieldsValue({
                    serviceName: '',
                    groupName: 'DEFAULT_GROUP',
                    protectThreshold: 0,
                  });
                  setServiceModalOpen(true);
                }}
              >
                {tr('nacos_service.action.create_service')}
              </Button>
            </Space>
          </div>
          <div className={isV2Ui ? 'gn-v2-nacos-pane-body' : undefined} style={{ flex: 1, minHeight: 0, padding: isV2Ui ? undefined : 8 }}>
            <Table
              size="small"
              loading={loadingServices}
              rowKey={(row) => row.rawName}
              dataSource={serviceRows}
              pagination={{
                current: pageNo,
                pageSize,
                total: serviceTotal,
                showSizeChanger: false,
                onChange: (page) => void loadServices(page),
              }}
              onRow={(record) => ({
                onClick: () => {
                  setSelectedServiceRaw(record.rawName);
                  setInstances([]);
                  void loadInstances(record.rawName);
                },
              })}
              rowClassName={(record) =>
                selectedServiceRaw === record.rawName ? 'ant-table-row-selected' : ''
              }
              scroll={{ y: 'calc(100vh - 280px)' }}
              columns={[
                {
                  title: tr('nacos_service.field.service'),
                  dataIndex: 'serviceName',
                  key: 'serviceName',
                  ellipsis: true,
                  render: (_: unknown, row: NacosServiceRow) => (
                    <div style={{ minWidth: 0 }}>
                      <div
                        title={row.serviceName}
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {row.serviceName}
                      </div>
                      <div
                        title={row.groupName}
                        style={{
                          marginTop: 2,
                          color: workbenchTheme.textMuted,
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.groupName}
                      </div>
                    </div>
                  ),
                },
                {
                  title: tr('nacos_viewer.action.delete'),
                  key: 'actions',
                  width: 90,
                  render: (_: unknown, row: NacosServiceRow) => (
                    <Popconfirm
                      title={tr('nacos_service.message.confirm_delete_service', { name: row.rawName })}
                      disabled={structureRestricted}
                      onConfirm={() => void handleDeleteService(row.rawName)}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={structureRestricted}
                      />
                    </Popconfirm>
                  ),
                },
              ]}
            />
          </div>
        </div>

        <RedisResizableDivider
          targetRef={leftPanelRef}
          onResizeEnd={setLeftPanelWidth}
          minWidth={260}
          maxReservedWidth={isV2Ui ? 321 : 320}
          containerWidthCssVariable={isV2Ui ? '--gn-nacos-sidebar-width' : undefined}
          title={tr('redis_viewer.tooltip.resize_panels')}
        />

        <div
          className={isV2Ui ? 'gn-v2-nacos-detail-pane' : undefined}
          style={
            isV2Ui
              ? { minHeight: 0, overflow: 'hidden' }
              : {
                  ...workbenchCardStyle,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }
          }
        >
          <div
            className={isV2Ui ? 'gn-v2-nacos-pane-header' : undefined}
            style={isV2Ui ? undefined : { padding: 8, marginBottom: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Space wrap size={[8, 8]}>
                {selectedServiceRaw ? (
                  <>
                    <Tag color="blue">{selectedParsed?.groupName}</Tag>
                    <strong style={{ color: workbenchTheme.textPrimary }}>{selectedParsed?.serviceName}</strong>
                  </>
                ) : (
                  <span style={{ color: workbenchTheme.textMuted }}>{tr('nacos_service.message.select_service')}</span>
                )}
              </Space>
              <Space wrap size={[8, 8]}>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={loadingInstances}
                  disabled={!selectedServiceRaw}
                  onClick={() => selectedServiceRaw && void loadInstances(selectedServiceRaw)}
                >
                  {tr('nacos_viewer.action.refresh')}
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={dataEditRestricted || !selectedServiceRaw}
                  onClick={openRegisterInstance}
                >
                  {tr('nacos_service.action.register_instance')}
                </Button>
              </Space>
            </div>
          </div>
          <div
            className={isV2Ui ? 'gn-v2-nacos-pane-body' : undefined}
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: isV2Ui ? undefined : 12,
              overflow: 'hidden',
            }}
          >
          {!selectedServiceRaw ? (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: workbenchTheme.textMuted }}>
              {tr('nacos_service.message.select_service')}
            </div>
          ) : (
            <>
              <Table
                size="small"
                loading={loadingInstances}
                rowKey={(row) => `${row.ip}:${row.port}:${row.clusterName || ''}`}
                dataSource={instances}
                pagination={false}
                scroll={{ y: 'calc(100vh - 320px)' }}
                columns={[
                  { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130 },
                  { title: 'Port', dataIndex: 'port', key: 'port', width: 80 },
                  {
                    title: tr('nacos_service.field.cluster'),
                    dataIndex: 'clusterName',
                    key: 'clusterName',
                    width: 110,
                    render: (value: string) => value || 'DEFAULT',
                  },
                  {
                    title: tr('nacos_service.field.weight'),
                    dataIndex: 'weight',
                    key: 'weight',
                    width: 80,
                  },
                  {
                    title: tr('nacos_service.field.healthy'),
                    dataIndex: 'healthy',
                    key: 'healthy',
                    width: 100,
                    render: (value: boolean, row: NacosInstance) => (
                      <Switch
                        size="small"
                        checked={!!value}
                        disabled={dataEditRestricted}
                        onChange={(checked) => void handleToggleHealth(row, checked)}
                      />
                    ),
                  },
                  {
                    title: tr('nacos_service.field.enabled'),
                    dataIndex: 'enabled',
                    key: 'enabled',
                    width: 90,
                    render: (value: boolean) =>
                      value ? <Tag color="green">on</Tag> : <Tag>off</Tag>,
                  },
                  {
                    title: tr('nacos_viewer.action.history'),
                    key: 'actions',
                    width: 160,
                    render: (_: unknown, row: NacosInstance) => (
                      <Space>
                        <Button
                          size="small"
                          disabled={dataEditRestricted}
                          onClick={() => openEditInstance(row)}
                        >
                          {tr('nacos_service.action.edit_instance')}
                        </Button>
                        <Popconfirm
                          title={tr('nacos_service.message.confirm_deregister', {
                            ip: row.ip,
                            port: row.port,
                          })}
                          disabled={dataEditRestricted}
                          onConfirm={() => void handleDeregister(row)}
                        >
                          <Button size="small" danger disabled={dataEditRestricted}>
                            {tr('nacos_service.action.deregister')}
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          )}
          </div>
        </div>
      </div>

      <Modal
        title={tr('nacos_service.action.create_service')}
        open={serviceModalOpen}
        onCancel={() => setServiceModalOpen(false)}
        onOk={() => void handleCreateService()}
        destroyOnClose
      >
        <Form form={serviceForm} layout="vertical" initialValues={{ groupName: 'DEFAULT_GROUP' }}>
          <Form.Item
            name="serviceName"
            label={tr('nacos_service.field.service')}
            rules={[{ required: true }]}
          >
            <Input {...noAutoCapInputProps} />
          </Form.Item>
          <Form.Item name="groupName" label={tr('nacos_service.field.group')}>
            <Input {...noAutoCapInputProps} />
          </Form.Item>
          <Form.Item name="protectThreshold" label={tr('nacos_service.field.protect_threshold')}>
            <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          editingInstance
            ? tr('nacos_service.action.edit_instance')
            : tr('nacos_service.action.register_instance')
        }
        open={instanceModalOpen}
        onCancel={() => setInstanceModalOpen(false)}
        onOk={() => void handleSaveInstance()}
        destroyOnClose
      >
        <Form form={instanceForm} layout="vertical">
          <Form.Item name="serviceName" label={tr('nacos_service.field.service')}>
            <Input disabled {...noAutoCapInputProps} />
          </Form.Item>
          <Form.Item name="groupName" label={tr('nacos_service.field.group')}>
            <Input disabled {...noAutoCapInputProps} />
          </Form.Item>
          <Form.Item name="ip" label="IP" rules={[{ required: true }]}>
            <Input disabled={!!editingInstance} {...noAutoCapInputProps} />
          </Form.Item>
          <Form.Item name="port" label="Port" rules={[{ required: true }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} disabled={!!editingInstance} />
          </Form.Item>
          <Form.Item name="clusterName" label={tr('nacos_service.field.cluster')}>
            <Input {...noAutoCapInputProps} />
          </Form.Item>
          <Form.Item name="weight" label={tr('nacos_service.field.weight')}>
            <InputNumber min={0} max={10000} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="enabled" label={tr('nacos_service.field.enabled')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="ephemeral" label={tr('nacos_service.field.ephemeral')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="healthy" label={tr('nacos_service.field.healthy')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
};

export default NacosServiceViewer;
