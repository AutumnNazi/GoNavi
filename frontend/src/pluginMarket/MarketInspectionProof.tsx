import { Alert, Descriptions } from 'antd';
import { useI18n } from '../i18n/provider';
import type { MarketInspectionQuote } from './types';

interface Props { quote: MarketInspectionQuote; source: string; error: string; consumed: boolean; installing: boolean }
export function MarketInspectionProof({ quote, source, error, consumed, installing }: Props) {
  const { t, language } = useI18n();
  return <div className="plugin-stack">
    <Alert showIcon type="info" message={t('plugin.market.inspection_verified')} />
    <Descriptions column={1} size="small" bordered items={[
      { key: 'source', label: t('plugin.market.source'), children: <span className="plugin-break">{source}</span> },
      { key: 'sourceId', label: t('plugin.market.source_identity'), children: <code className="plugin-break">{quote.sourceId}</code> },
      { key: 'artifact', label: t('plugin.market.artifact_digest'), children: <code className="plugin-break">{quote.artifactDigest}</code> },
      { key: 'expires', label: t('plugin.market.inspection_expires'), children: new Date(quote.expiresAt).toLocaleString(language) },
    ]} />
    {error && <Alert showIcon type="warning" message={error} />}
    {consumed && !installing && <Alert type="info" message={t('plugin.market.inspection_used')} />}
  </div>;
}
