import { Typography } from 'antd';
import { useI18n } from '../../i18n/provider';
import type { PluginManifest } from '../../plugins/types';

export function PluginExporterSummary({ manifest }: { manifest: PluginManifest }) {
  const { t } = useI18n();
  const exporters = manifest.contributes?.exporters ?? [];
  if (!exporters.length) return null;
  return <div><Typography.Text strong>{t('plugin.exporter.hint')}</Typography.Text>
    <ul>{exporters.map((exporter) => <li key={exporter.id}><code>{exporter.id}</code> <code>{exporter.extension}</code> <code>{exporter.contentType}</code>{exporter.streaming ? <> <code>{t('plugin.exporter.streaming')}</code></> : null}</li>)}</ul></div>;
}
