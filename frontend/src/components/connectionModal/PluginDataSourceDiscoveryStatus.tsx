import { Alert, Button } from 'antd';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import { usePluginDataSources } from '../../plugins/dataSource/usePluginDataSources';
import { refreshPluginDataSources } from '../../plugins/dataSource/discovery';
export function PluginDataSourceDiscoveryStatus() {
  const t = useOptionalI18n()?.t ?? translate;
  const catalog = usePluginDataSources(false);
  if (!catalog.error) return null;
  return <Alert type="warning" showIcon message={catalog.error.startsWith('plugin.') ? t(catalog.error) : catalog.error}
    action={<Button loading={catalog.loading} onClick={() => void refreshPluginDataSources()}>{t('plugin.action.refresh')}</Button>} />;
}
