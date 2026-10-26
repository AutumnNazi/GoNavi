import { Alert, Button } from 'antd';
import { t } from '../../i18n';
import type { useExporterChoice } from './useChoice';
import { isPluginExporterNamespace } from './identity';
export function ExporterSelectionNotice({ choice, format }: { choice: ReturnType<typeof useExporterChoice>; format: string }) {
  const { catalog } = choice; const selected = isPluginExporterNamespace(format);
  const item = catalog.items.find((entry) => entry.format === format);
  return <div>
    <p>{t('plugin.exporter.hint')}</p>
    {catalog.error && <Alert type="warning" showIcon message={t(catalog.error)} />}
    {catalog.truncated && <Alert type="info" message={t('plugin.exporter.truncated')} />}
    {selected && !choice.isCurrent() && <Alert type="warning" showIcon message={t('plugin.exporter.stale')} />}
    {selected && <><p><code>{format}</code></p><p>{t(item?.streaming ? 'plugin.exporter.streaming_limits' : 'plugin.exporter.limits')}</p></>}
    <Button size="small" loading={catalog.loading} onClick={() => void catalog.refresh()}>{t('plugin.exporter.refresh')}</Button>
  </div>;
}
