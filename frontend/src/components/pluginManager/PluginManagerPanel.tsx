import { useState } from 'react';
import { Alert, Button, Empty, Pagination, Spin, Tabs, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import { usePluginManager } from '../../plugins/usePluginManager';
import { PluginMarketPanel } from '../../pluginMarket/PluginMarketPanel';
import { LocalInstallPanel } from './LocalInstallPanel';
import { PluginCard } from './PluginCard';
import './pluginManager.css';

export function PluginManagerPanel() {
  const { t } = useI18n();
  const manager = usePluginManager();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(manager.plugins.length / 10)));
  const installed = <div className="plugin-stack">
    <LocalInstallPanel allowed={manager.runtime.managementAllowed} onInstalled={() => void manager.refresh()}
      installedIds={new Set(manager.plugins.map((plugin) => plugin.manifest.id))} />
    <div className="plugin-toolbar"><Typography.Text strong>{t('plugin.manager.installed')}</Typography.Text>
      <Button icon={<ReloadOutlined />} onClick={() => void manager.refresh()}>{t('plugin.action.refresh')}</Button></div>
    {manager.error && <Alert showIcon type="error" message={manager.error} />}
    {manager.loading ? <Spin /> : !manager.error && manager.plugins.length === 0 ? <Empty description={t('plugin.manager.empty')} /> : null}
    {manager.plugins.slice((currentPage - 1) * 10, currentPage * 10).map((plugin) => <PluginCard key={plugin.manifest.id} plugin={plugin} manager={manager}
      expanded={expandedId === plugin.manifest.id} onToggle={() => setExpandedId(expandedId === plugin.manifest.id ? null : plugin.manifest.id)} />)}
    {manager.plugins.length > 10 && <Pagination current={currentPage} pageSize={10} total={manager.plugins.length} onChange={setPage} showSizeChanger={false} />}
  </div>;
  return <section className="plugin-manager">
    <header className="plugin-manager-heading"><Typography.Title level={4}>{t('plugin.manager.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('plugin.manager.description')}</Typography.Paragraph></header>
    {manager.runtime.safeMode && <Alert showIcon type="warning" message={t('plugin.manager.safe_mode')} />}
    {!manager.loading && !manager.error && !manager.runtime.managementAllowed && <Alert showIcon type="info"
      message={t(manager.runtime.webRuntime === true ? 'plugin.manager.read_only_web' : 'plugin.manager.read_only')} />}
    <Tabs destroyInactiveTabPane items={[
      { key: 'installed', label: t('plugin.manager.installed'), children: installed },
      { key: 'market', label: t('plugin.market.title'), children: <PluginMarketPanel allowed={manager.runtime.managementAllowed} onInstalled={() => void manager.refresh()} /> },
    ]} />
  </section>;
}
