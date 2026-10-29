import { Button, Tooltip } from 'antd';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import { formatAccountAmount } from './aiPluginProviderAccountApi';
import { usePluginProviderAccount } from './usePluginProviderAccount';
import AIPluginProviderAccountKeys from './AIPluginProviderAccountKeys';

interface AIPluginProviderAccountProps {
  pluginId?: string;
}

// The account block opens the provider form, so it stays frameless: one header line,
// one ruled stat strip, then a quiet key list. No nested cards, no full-width buttons.
export default function AIPluginProviderAccount({ pluginId }: AIPluginProviderAccountProps) {
  const t = useOptionalI18n()?.t ?? translate;
  const account = usePluginProviderAccount(pluginId);
  if (!pluginId || !account.visible) return null;

  const status = account.status;
  const ready = status?.state === 'ready';
  const loginLoading = account.busy || account.polling;
  const metrics = ready
    ? [
      { key: 'balance', label: t('plugin.ai_provider.account.metric_balance'), value: formatAccountAmount(status?.balance) },
      { key: 'frozen', label: t('plugin.ai_provider.account.metric_frozen'), value: formatAccountAmount(status?.frozenBalance) },
      { key: 'recharged', label: t('plugin.ai_provider.account.metric_recharged'), value: formatAccountAmount(status?.totalRecharged) },
      {
        key: 'concurrency',
        label: t('plugin.ai_provider.account.metric_concurrency'),
        value: status?.concurrency === undefined ? '-' : String(status.concurrency),
      },
    ]
    : [];

  return (
    <section className="gn-account">
      <header className="gn-account-head">
        <span className="gn-account-title">{t('plugin.ai_provider.account.title')}</span>
        {ready && <span className="gn-account-email" title={status?.email || status?.userId || ''}>{status?.email || status?.userId || '-'}</span>}
        {ready && (
          <span className="gn-account-actions">
            <Button type="text" size="small" onClick={account.onRefresh} loading={account.refreshing}>
              {t('plugin.ai_provider.account.refresh')}
            </Button>
            <Button type="text" size="small" className="gn-account-danger" onClick={account.onLogout} loading={account.busy}>
              {t('plugin.ai_provider.account.logout')}
            </Button>
          </span>
        )}
      </header>

      {ready ? (
        <>
          <dl className="gn-account-stats">
            {metrics.map((metric) => (
              <div className="gn-account-stat" key={metric.key}>
                <dt className="gn-account-stat-label">{metric.label}</dt>
                <dd className="gn-account-stat-value">{metric.value}</dd>
              </div>
            ))}
          </dl>
          <AIPluginProviderAccountKeys keys={account.keys} t={t} />
        </>
      ) : (
        <div className="gn-account-empty">
          <span className="gn-account-avatar" aria-hidden="true">華</span>
          <div className="gn-account-empty-copy">
            <span className="gn-account-empty-title">{t('plugin.ai_provider.account.signed_out_hint')}</span>
            {account.timedOut && (
              <span className="gn-account-empty-note" role="status">{t('plugin.ai_provider.account.login_timeout')}</span>
            )}
          </div>
          <Tooltip title={account.polling ? t('plugin.ai_provider.account.login_waiting') : ''}>
            <Button size="small" onClick={account.onLogin} loading={loginLoading}>
              {t(loginLoading ? 'plugin.ai_provider.account.login_waiting' : 'plugin.ai_provider.account.login')}
            </Button>
          </Tooltip>
        </div>
      )}

      {account.error && <p className="gn-account-error" role="alert">{account.error}</p>}
    </section>
  );
}
