import { Alert, Button } from 'antd';
import type { FormInstance } from 'antd';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import './pluginDataSource.css';
import { pluginTransportDefaults } from './pluginDataSourceForm';
export function PluginDataSourceNetworkNotice({ form }: { form: FormInstance }) {
  const t = useOptionalI18n()?.t ?? translate;
  return <div className="plugin-data-source-stack"><Alert type="info" showIcon message={t('plugin.datasource.unsupported_transport')} />
    <Button onClick={() => form.setFieldsValue(pluginTransportDefaults)}>{t('plugin.datasource.clear_transport')}</Button>
  </div>;
}
