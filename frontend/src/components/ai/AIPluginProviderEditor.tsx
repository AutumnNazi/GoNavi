import { Alert, Button, Form, Input, InputNumber, Select, Space, Tag, Typography } from 'antd';
import type { AISettingsProvidersSectionProps } from './AISettingsProvidersSection';
import { usePluginProviderCatalog } from '../../plugins/aiProvider/context';
import { clearedPluginProviderSettings, hasForeignPluginProviderSettings } from '../../plugins/aiProvider/configValidation';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import AIProviderKeyValueRows from './AIProviderKeyValueRows';
import AISettingsProviderTestResult from './AISettingsProviderTestResult';

export function AIPluginProviderEditor(props: AISettingsProvidersSectionProps) {
  const t = useOptionalI18n()?.t ?? translate; const catalog = usePluginProviderCatalog(); const { form, editingProvider } = props;
  const values = Form.useWatch([], { form, preserve: true }) as Record<string, unknown> | undefined;
  const type = editingProvider?.type || String(values?.type || props.watchedPresetKey || '');
  const source = catalog?.find(type); const modelId = String(values?.model ?? editingProvider?.model ?? '');
  const model = source?.models.find((item) => item.id === modelId);
  const unsupported = hasForeignPluginProviderSettings({ ...editingProvider, ...form.getFieldsValue(true), ...values }, source?.supportsImages === true);
  const models = (source?.models ?? []).map((item) => ({ value: item.id, label: item.name + ' · ' + item.id }));
  if (modelId && !models.some((item) => item.value === modelId)) models.unshift({ value: modelId, label: modelId + ' · ' + t('plugin.ai_provider.saved_model') });
  const clearUnsupported = () => { form.setFieldsValue(clearedPluginProviderSettings); props.onValuesChange?.(clearedPluginProviderSettings); };
  return <div className="gn-plugin-provider-editor">
    <div><Tag>{t('plugin.ai_provider.label')}</Tag><Typography.Text strong>{source?.name || editingProvider?.name || type}</Typography.Text></div>
    <Typography.Text code className="gn-plugin-provider-wrap">{type}</Typography.Text>
    <p>{t('plugin.ai_provider.catalog_hint')}</p>
    {!source?.available && <Alert type="warning" showIcon message={t('plugin.ai_provider.error.unavailable')} />}
    {unsupported && <Alert type="error" showIcon message={t('plugin.ai_provider.error.unsupported_settings')} />}
    <Form form={form} layout="vertical" onValuesChange={props.onValuesChange}>
      <Form.Item name="id" hidden><Input /></Form.Item><Form.Item name="type" hidden><Input /></Form.Item><Form.Item name="presetKey" hidden><Input /></Form.Item>
      <Form.Item name="name" label={t('plugin.ai_provider.name')}><Input maxLength={256} /></Form.Item>
      <Form.Item name="baseUrl" label={t('plugin.ai_provider.base_url')} extra={t('plugin.ai_provider.base_url_hint')}><Input autoComplete="off" maxLength={4096} /></Form.Item>
      <Form.Item name="apiKey" label={t('plugin.ai_provider.api_key')} extra={t('plugin.ai_provider.secret_hint')}>
        <Input.Password autoComplete="new-password" visibilityToggle={{ visible: props.primaryPasswordVisible, onVisibleChange: props.onPrimaryPasswordVisibleChange }} />
      </Form.Item>
      <Form.Item name="model" label={t('plugin.ai_provider.model')} rules={[{ required: true }]}><Select options={models} showSearch optionFilterProp="label" /></Form.Item>
      <Form.Item name="inlineCompletionModel" label={t('plugin.ai_provider.inline_model')}><Select options={models} allowClear showSearch optionFilterProp="label" /></Form.Item>
      <Form.Item name="temperature" label={t('plugin.ai_provider.temperature')}><InputNumber min={0} max={2} step={0.1} /></Form.Item>
      <Form.Item name="contextWindow" label={t('plugin.ai_provider.context')} extra={t('plugin.ai_provider.context_hint')}><InputNumber min={0} max={262144} step={1024} /></Form.Item>
      {model && <p>{t('plugin.ai_provider.model_limits', { context: model.contextWindow, output: model.maxOutputTokens })}</p>}
      <p>{t(source?.supportsTools ? 'plugin.ai_provider.tools_supported' : 'plugin.ai_provider.tools_unavailable')} · {t(source?.supportsImages ? 'plugin.ai_provider.images_supported' : 'plugin.ai_provider.no_images')}</p>
      <Form.Item name="headerRows" label={t('plugin.ai_provider.headers')}><AIProviderKeyValueRows namePlaceholder={t("plugin.ai_provider.header_name")} valuePlaceholder={t("plugin.ai_provider.header_value")} addLabel={t("plugin.ai_provider.add_header")} removeLabel={t("common.delete")} /></Form.Item>
      <Button onClick={clearUnsupported}>{t('plugin.ai_provider.clear_unsupported')}</Button>
    </Form>
    <AISettingsProviderTestResult testStatus={props.testStatus} testResult={props.testResult ?? null} copy={t} testAction={null} saveAction={null} />
    <Space wrap>
      <Button onClick={props.onCancelEdit}>{t('common.cancel')}</Button>
      <Button onClick={props.onTestProvider} loading={props.testing} disabled={!source?.available || !model || unsupported || props.loading}>{t('plugin.ai_provider.test')}</Button>
      <Button type="primary" onClick={props.onSaveProvider} loading={props.loading} disabled={unsupported || props.testing}>{t('common.save')}</Button>
      {editingProvider?.id && props.onSaveProviderAsCopy && <Button onClick={props.onSaveProviderAsCopy} disabled={unsupported || props.loading || props.testing}>{t('plugin.ai_provider.save_copy')}</Button>}
    </Space>
  </div>;
}
