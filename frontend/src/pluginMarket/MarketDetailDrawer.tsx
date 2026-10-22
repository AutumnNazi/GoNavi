import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Spin, Tag, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import { useMarketDetail } from './useMarketDetail';
import { MarketRatingsPanel } from './MarketRatingsPanel';
import { MarketInstallConsent } from './MarketInstallConsent';
import type { MarketInspectionRequest } from './types';

interface Props { id: string; source: string; allowed: boolean; authenticated: boolean; trustedOfficial: boolean; sourceId?: string; onClose: () => void; onInstalled: () => void }
export function MarketDetailDrawer({ id, source, allowed, authenticated, trustedOfficial, sourceId, onClose, onInstalled }: Props) {
  const { t } = useI18n();
  const detail = useMarketDetail(id, sourceId);
  const [request, setRequest] = useState<MarketInspectionRequest | null>(null);
  const [installError, setInstallError] = useState('');
  const plugin = detail.plugin;
  const artifact = plugin?.artifact;
  const canPreview = Boolean(plugin && artifact && artifact.version === plugin.version && plugin.id === id
    && sourceId && /^[a-f0-9]{64}$/.test(sourceId) && plugin.sourceId === sourceId);
  useEffect(() => { setRequest(null); }, [id, sourceId, plugin?.version, artifact?.sha256]);
  return <Drawer open width={680} title={plugin?.name ?? t('plugin.market.details')} onClose={onClose}>
    <div className="plugin-stack">
      {detail.loading && <Spin />}
      {installError && <Alert type="error" showIcon message={installError} />}
      {detail.error && <Alert type="error" showIcon message={t('plugin.market.unavailable')} description={detail.error}
        action={<Button onClick={() => void detail.load()}>{t('plugin.action.refresh')}</Button>} />}
      {plugin && <>
        {trustedOfficial && plugin.official && <Tag color="success">{t('plugin.market.official')}</Tag>}
        <code className="plugin-identity">{plugin.id} · {plugin.version}</code>
        <Typography.Paragraph>{plugin.description}</Typography.Paragraph>
        <Typography.Text type="secondary">{t('plugin.market.author', { name: plugin.author })}</Typography.Text>
        <Typography.Text type="secondary">{t('plugin.market.platforms', { platforms: plugin.platforms.join(', ') })}</Typography.Text>
        <Typography.Text>{plugin.ratingCount ? t('plugin.market.rating_summary', { average: plugin.ratingAverage.toFixed(2), count: plugin.ratingCount }) : t('plugin.market.no_ratings')}</Typography.Text>
        <Button type="primary" disabled={!allowed || !canPreview || detail.loading || Boolean(request)} onClick={() => {
          if (canPreview && artifact && sourceId) { setInstallError(''); setRequest({ id, version: plugin.version, artifactDigest: artifact.sha256, sourceId }); }
        }}>{t('plugin.market.preview_install')}</Button>
        {!canPreview && <Alert type="warning" message={t('plugin.market.no_artifact')} />}
        <MarketRatingsPanel ratings={detail.ratings} authenticated={authenticated && allowed} busy={detail.saving}
          onSave={detail.saveRating} onDelete={detail.deleteRating} />
      </>}
      {request && <MarketInstallConsent request={request} source={source} allowed={allowed} onClose={() => setRequest(null)}
        onInstalled={onInstalled} onInstallError={setInstallError} />}
    </div>
  </Drawer>;
}
