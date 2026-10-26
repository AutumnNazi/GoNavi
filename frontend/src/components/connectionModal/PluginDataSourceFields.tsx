import type { ReactNode } from 'react';
import { Alert, Checkbox, Form, Input, InputNumber, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import './pluginDataSource.css';
import { usePluginDataSources } from '../../plugins/dataSource/usePluginDataSources';
import { findPluginDataSource } from '../../plugins/dataSource/snapshot';
import { pluginDataSourceDisplayName, pluginDataSourceUnavailableReason } from '../../plugins/dataSource/presentation';
import { hasUnsupportedPluginTransport } from './pluginDataSourceForm';
import ConnectionEnvironmentSelect from '../ConnectionEnvironmentSelect';

interface Props { type: string; form: FormInstance; identityRows: ReactNode; hasStoredPassword?: boolean; passwordControls?: ReactNode; passwordVisibility: { visible: boolean; onVisibleChange: (visible: boolean) => void } }
export function PluginDataSourceFields({ type, form, identityRows, hasStoredPassword, passwordControls, passwordVisibility }: Props) {
  const t = useOptionalI18n()?.t ?? translate;
  usePluginDataSources(false);
  const item = findPluginDataSource(type);
  const writable = item?.readOnly === false;
  const reason = pluginDataSourceUnavailableReason(type);
  const values = Form.useWatch([], { form, preserve: true }) as Record<string, unknown> | undefined;
  return <div className="plugin-data-source-stack">
    <div><Tag color={writable ? 'orange' : 'green'}>{t(writable ? 'plugin.datasource.read_write' : 'plugin.datasource.read_only')}</Tag><Typography.Text strong>{pluginDataSourceDisplayName(type)}</Typography.Text></div>
    <Typography.Text code className="plugin-data-source-identity">{type}</Typography.Text>
    <Alert type={writable ? 'warning' : 'info'} showIcon message={t(writable ? 'plugin.datasource.read_write_description' : 'plugin.datasource.read_only_description')} />
    {reason && <Alert type="warning" showIcon message={reason} />}
    {item?.connectable && !item.available && <Alert type="info" showIcon message={t('plugin.datasource.start_on_connect')} />}
    {hasUnsupportedPluginTransport(values ?? form.getFieldsValue(true)) && <Alert type="error" showIcon message={t('plugin.datasource.unsupported_transport')} />}
    {identityRows}
    <Form.Item name="host" label={t('connection.modal.field.host.label')}><Input maxLength={1024} /></Form.Item>
    <Form.Item name="port" label={t('connection.modal.field.port.label')}><InputNumber min={0} max={65535} /></Form.Item>
    <Form.Item name="database" label={t('plugin.datasource.database')}><Input maxLength={1024} /></Form.Item>
    <Form.Item name="user" label={t('plugin.datasource.username')}><Input autoComplete="off" maxLength={1024} /></Form.Item>
    <Form.Item name="password" label={t('plugin.datasource.password')}><Input.Password autoComplete="new-password" visibilityToggle={passwordVisibility} placeholder={hasStoredPassword ? t("connection.modal.field.password.retained") : undefined} /></Form.Item>
    {passwordControls}
    <Form.Item name="savePassword" valuePropName="checked"><Checkbox>{t('plugin.datasource.save_password')}</Checkbox></Form.Item>
    <Form.Item name="environmentType" label={t('connection.modal.field.environment_type.label')}><ConnectionEnvironmentSelect /></Form.Item>
  </div>;
}
