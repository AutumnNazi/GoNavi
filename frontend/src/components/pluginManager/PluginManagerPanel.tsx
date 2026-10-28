import { useState } from 'react';
import { Alert, Button, Empty, Pagination, Spin, Tabs, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import { usePluginManager } from '../../plugins/usePluginManager';
import { notifyPluginLifecycle } from '../../plugins/events';
import { PluginMarketPanel } from '../../pluginMarket/PluginMarketPanel';
import { LocalInstallPanel } from './LocalInstallPanel';
import { PluginCard } from './PluginCard';
import './pluginManager.css';

export function PluginManagerPanel() {
  const { t } = useI18n();
  const manager = usePluginManager();
  const [activeTab, setActiveTab] = useState('installed');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(manager.plugins.length / 10)));
  const installed = <div className="plugin-installed-layout">
    <section className="plugin-library plugin-stack" aria-label={t('plugin.manager.installed')}>
      <header className="plugin-library-header">
        <div className="plugin-library-heading"><Typography.Text strong>{t('plugin.manager.installed')}</Typography.Text>
          <Tag>{manager.plugins.length}</Tag></div>
        <Button type="text" icon={<ReloadOutlined aria-hidden />} onClick={() => void manager.refresh()}>{t('plugin.action.refresh')}</Button>
      </header>
      {manager.error && <Alert showIcon type="error" message={manager.error} />}
      {manager.loading ? <div className="plugin-library-state" aria-busy="true"><Spin /></div>
        : !manager.error && manager.plugins.length === 0 ? <div className="plugin-library-state">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('plugin.manager.empty')}>
            <Button type="primary" onClick={() => setActiveTab('market')}>{t('plugin.market.title')}</Button>
          </Empty>
        </div> : null}
      {manager.plugins.slice((currentPage - 1) * 10, currentPage * 10).map((plugin) => <PluginCard key={plugin.manifest.id} plugin={plugin} manager={manager}
        expanded={expandedId === plugin.manifest.id} onToggle={() => setExpandedId(expandedId === plugin.manifest.id ? null : plugin.manifest.id)} />)}
      {manager.plugins.length > 10 && <Pagination current={currentPage} pageSize={10} total={manager.plugins.length} onChange={setPage} showSizeChanger={false} />}
    </section>
    <LocalInstallPanel allowed={manager.runtime.managementAllowed} onInstalled={() => { void manager.refresh(); notifyPluginLifecycle(); }}
      installedIds={new Set(manager.plugins.map((plugin) => plugin.manifest.id))} />
  </div>;
  return <section className="plugin-manager">
    <header className="plugin-manager-heading"><Typography.Title level={4}>{t('plugin.manager.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('plugin.manager.description')}</Typography.Paragraph></header>
    {manager.runtime.safeMode && <Alert showIcon type="warning" message={t('plugin.manager.safe_mode')} />}
    {!manager.loading && !manager.error && !manager.runtime.managementAllowed && <Alert showIcon type="info"
      message={t(manager.runtime.webRuntime === true ? 'plugin.manager.read_only_web' : 'plugin.manager.read_only')} />}
    <Tabs className="plugin-manager-tabs" size="small" tabBarGutter={0} activeKey={activeTab} onChange={setActiveTab} destroyInactiveTabPane items={[
      { key: 'installed', label: t('plugin.manager.installed'), children: installed },
      { key: 'market', label: t('plugin.market.title'), children: <PluginMarketPanel allowed={manager.runtime.managementAllowed} onInstalled={() => { void manager.refresh(); notifyPluginLifecycle(); }} /> },
    ]} />
  </section>;
}
