import { Button, Rate, Tag, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n/provider';
import type { MarketPlugin } from './types';

export function MarketPluginCard({ plugin, onSelect }: { plugin: MarketPlugin; onSelect: () => void }) {
  const { t } = useI18n();
  return <article className="plugin-card plugin-market-card" data-official={plugin.official}>
    <header className="plugin-card-header"><Typography.Title level={5}>{plugin.name}</Typography.Title>
      {plugin.official && <Tag color="success" icon={<SafetyCertificateOutlined />}>{t('plugin.market.official')}</Tag>}</header>
    <code className="plugin-identity">{plugin.id} · {plugin.version}</code>
    <Typography.Paragraph ellipsis={{ rows: 3 }}>{plugin.description}</Typography.Paragraph>
    <div className="plugin-market-metrics">
      {plugin.ratingCount > 0 ? <><Rate disabled allowHalf value={plugin.ratingAverage} /><span>{t('plugin.market.rating_summary', { average: plugin.ratingAverage.toFixed(2), count: plugin.ratingCount })}</span></>
        : <span>{t('plugin.market.no_ratings')}</span>}
      <span>{t('plugin.market.downloads', { count: plugin.downloadCount.toLocaleString() })}</span>
    </div>
    <Button onClick={onSelect}>{t('plugin.market.details')}</Button>
  </article>;
}
