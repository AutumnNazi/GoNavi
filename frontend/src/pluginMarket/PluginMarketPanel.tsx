import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Spin, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import { useMarketAccount } from './useMarketAccount';
import { useMarketCatalog } from './useMarketCatalog';
import { useInstalledPluginVersions } from './useInstalledPluginVersions';
import { MarketAccountPanel } from './MarketAccountPanel';
import { MarketPluginCard } from './MarketPluginCard';
import { MarketDetailDrawer } from './MarketDetailDrawer';
import './pluginMarket.css';

export function PluginMarketPanel({ allowed, onInstalled }: { allowed: boolean; onInstalled: () => void }) {
  const { t } = useI18n();
  const account = useMarketAccount();
  const source = account.settings?.baseUrl ?? '';
  const trustedOfficial = Boolean(account.settings?.trustedOfficial);
  const catalog = useMarketCatalog(source, account.revision, trustedOfficial, account.settings?.sourceId);
  const { installed, refresh: refreshInstalled } = useInstalledPluginVersions(account.revision);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [source, account.revision]);
  const handleInstalled = () => { refreshInstalled(); onInstalled(); };
  return <div className="plugin-market">
    <MarketAccountPanel account={account} allowed={allowed} onRefresh={() => { void account.refresh(); catalog.reload(); }} />
    <section className="plugin-market-browser" aria-label={t('plugin.market.title')} aria-busy={catalog.loading}>
      <div className="plugin-market-toolbar">
        <Input.Search aria-label={t('plugin.market.search')} placeholder={t('plugin.market.search')} allowClear
          value={catalog.query} onChange={(event) => catalog.setQuery(event.target.value)} onSearch={catalog.reload} maxLength={200} />
        <Select aria-label={t('plugin.market.sort')} value={catalog.sort} onChange={catalog.setSort} options={[
          { value: 'updated', label: t('plugin.market.sort_updated') }, { value: 'rating', label: t('plugin.market.sort_rating') },
          { value: 'downloads', label: t('plugin.market.sort_downloads') },
        ]} />
      </div>
      {source && <div className="plugin-market-summary">
        <Typography.Text strong aria-live="polite">{t('plugin.market.result_count', { count: catalog.items.length })}</Typography.Text>
        <Typography.Text type="secondary">{t(trustedOfficial ? 'plugin.market.official_first' : 'plugin.market.untrusted_source')}</Typography.Text>
      </div>}
      {account.settings && !source && <Alert type="info" showIcon message={t('plugin.market.no_source')} />}
      {catalog.stale && <Alert type="warning" showIcon message={t('plugin.market.cached')} description={catalog.cachedAt ? t('plugin.market.cached_at', { time: catalog.cachedAt }) : undefined} />}
      {catalog.warning && <Alert type="warning" showIcon message={catalog.warning} />}
      {catalog.error && <Alert type="error" showIcon message={t('plugin.market.unavailable')} description={catalog.error}
        action={<Button onClick={catalog.reload}>{t('plugin.action.refresh')}</Button>} />}
      {catalog.loading && <div className="plugin-market-loading"><Spin /></div>}
      {source && !catalog.loading && !catalog.error && catalog.items.length === 0 && <div className="plugin-market-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(catalog.query ? 'plugin.market.empty_search' : 'plugin.market.empty')}>
          <Button onClick={catalog.query ? () => catalog.setQuery('') : catalog.reload}>
            {t(catalog.query ? 'plugin.market.reset_search' : 'plugin.action.refresh')}
          </Button>
        </Empty>
      </div>}
      <div className="plugin-market-grid">{catalog.items.map((plugin) => <MarketPluginCard key={plugin.id} plugin={plugin}
        installedVersion={installed.get(plugin.id)} onSelect={() => setSelected(plugin.id)} />)}</div>
      {catalog.nextCursor && <Button className="plugin-market-load-more" onClick={catalog.more} disabled={catalog.loading}>{t('plugin.market.load_more')}</Button>}
    </section>
    {selected && <MarketDetailDrawer key={source + ':' + selected} id={selected} source={source} allowed={allowed} trustedOfficial={trustedOfficial} sourceId={account.settings?.sourceId}
      authenticated={Boolean(account.settings?.authenticated)} onClose={() => { setSelected(null); catalog.reload(); }} onInstalled={handleInstalled} />}
  </div>;
}
