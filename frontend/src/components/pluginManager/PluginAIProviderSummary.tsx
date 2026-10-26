import { Tag, Typography } from 'antd';
import { useI18n } from '../../i18n/provider';
import type { PluginManifest } from '../../plugins/types';

export function PluginAIProviderSummary({ manifest }: { manifest: PluginManifest }) {
  const { t } = useI18n();
  const providers = manifest.contributes?.aiProviders ?? [];
  if (!providers.length) return null;
  return <div><Typography.Text strong>{t('plugin.ai_provider.label')}</Typography.Text>
    <ul>{providers.map((provider) => <li key={provider.id}><code>{provider.id}</code> {provider.models.map((model) => model.id).join(', ')}
      {provider.supportsImages ? <Tag color="blue">{t('plugin.ai_provider.images_supported')}</Tag> : <Tag>{t('plugin.ai_provider.no_images')}</Tag>}</li>)}</ul></div>;
}
