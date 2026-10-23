import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Spin, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import { useMarketAccount } from './useMarketAccount';
import { useMarketCatalog } from './useMarketCatalog';
import { MarketAccountPanel } from './MarketAccountPanel';
import { MarketPluginCard } from './MarketPluginCard';
import { MarketDetailDrawer } from './MarketDetailDrawer';

export function PluginMarketPanel({ allowed, onInstalled }: { allowed: boolean; onInstalled: () => void }) {
  const { t } = useI18n();
  const account = useMarketAccount();
  const source = account.settings?.baseUrl ?? '';
  const trustedOfficial = Boolean(account.settings?.trustedOfficial);
  const catalog = useMarketCatalog(source, account.revision, trustedOfficial, account.settings?.sourceId);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [source, account.revision]);
  return <div className="plugin-stack">
    <MarketAccountPanel account={account} allowed={allowed} />
    {source && <Typography.Text type="secondary">{t(trustedOfficial ? 'plugin.market.official_first' : 'plugin.market.untrusted_source')}</Typography.Text>}
    <div className="plugin-toolbar"><Input.Search aria-label={t('plugin.market.search')} placeholder={t('plugin.market.search')}
      value={catalog.query} onChange={(event) => catalog.setQuery(event.target.value)} onSearch={catalog.reload} maxLength={200} />
      <Select aria-label={t('plugin.market.sort')} value={catalog.sort} onChange={catalog.setSort} options={[
        { value: 'updated', label: t('plugin.market.sort_updated') }, { value: 'rating', label: t('plugin.market.sort_rating') },
        { value: 'downloads', label: t('plugin.market.sort_downloads') },
      ]} /></div>
    {account.settings && !source && <Alert type="info" showIcon message={t('plugin.market.no_source')} />}
    {catalog.stale && <Alert type="warning" showIcon message={t('plugin.market.cached')} description={catalog.cachedAt ? t('plugin.market.cached_at', { time: catalog.cachedAt }) : undefined} />}
    {catalog.warning && <Alert type="warning" showIcon message={catalog.warning} />}
    {catalog.error && <Alert type="error" showIcon message={t('plugin.market.unavailable')} description={catalog.error}
      action={<Button onClick={catalog.reload}>{t('plugin.action.refresh')}</Button>} />}
    {catalog.loading && <Spin />}
    {source && !catalog.loading && !catalog.error && catalog.items.length === 0 && <Empty description={t('plugin.market.empty')} />}
    <div className="plugin-market-grid">{catalog.items.map((plugin) => <MarketPluginCard key={plugin.id} plugin={plugin} onSelect={() => setSelected(plugin.id)} />)}</div>
    {catalog.nextCursor && <Button onClick={catalog.more} disabled={catalog.loading}>{t('plugin.market.load_more')}</Button>}
    {selected && <MarketDetailDrawer key={source + ':' + selected} id={selected} source={source} allowed={allowed} trustedOfficial={trustedOfficial} sourceId={account.settings?.sourceId}
      authenticated={Boolean(account.settings?.authenticated)} onClose={() => { setSelected(null); catalog.reload(); }} onInstalled={onInstalled} />}
  </div>;
}
