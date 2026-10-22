import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Input, Space, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import type { MarketAccount } from './useMarketAccount';
import { safeHTTPURL } from './decode';
import { BrowserOpenURL } from '../../wailsjs/runtime';

export function MarketAccountPanel({ account, allowed }: { account: MarketAccount; allowed: boolean }) {
  const { t } = useI18n();
  const [source, setSource] = useState('');
  useEffect(() => { setSource(account.settings?.baseUrl ?? ''); }, [account.settings?.baseUrl]);
  return <div className="plugin-stack">
    <div className="plugin-toolbar">{account.settings && <Typography.Text>{t(account.settings.authenticated ? 'plugin.market.signed_in' : 'plugin.market.signed_out')}</Typography.Text>}
      <Space wrap><Button onClick={() => void account.refresh()}>{t('plugin.action.refresh')}</Button>
        {account.settings?.authenticated ? <Button onClick={() => void account.logout()} disabled={!allowed || account.busy}>{t('plugin.market.sign_out')}</Button>
          : <Button onClick={() => void account.start()} disabled={!allowed || !account.settings?.baseUrl || account.busy || Boolean(account.login)}>{t('plugin.market.sign_in')}</Button>}
      </Space></div>
    <Collapse items={[{ key: 'source', label: t('plugin.market.source'), children: <div className="plugin-stack">
      <Typography.Text type="secondary">{t('plugin.market.source_hint')}</Typography.Text>
      <div className="plugin-toolbar"><Input aria-label={t('plugin.market.source')} value={source} onChange={(event) => setSource(event.target.value)} disabled={!allowed || account.busy} />
        <Button onClick={() => void account.configure(source.trim())} loading={account.busy}
          disabled={!allowed || (Boolean(source.trim()) && !safeHTTPURL(source.trim()))}>{t('plugin.market.save_source')}</Button></div>
    </div> }]} />
    {account.error && <Alert showIcon type="error" message={t('plugin.market.unavailable')} description={account.error} />}
    {account.login && <Alert type="info" showIcon message={t('plugin.market.auth_instructions')} description={<div className="plugin-stack">
      <Typography.Text className="plugin-account-code" copyable>{account.login.userCode}</Typography.Text>
      <a href={account.login.verificationUri} target="_blank" rel="noopener noreferrer" onClick={(event) => {
        event.preventDefault();
        try { BrowserOpenURL(account.login!.verificationUri); } catch { window.open(account.login!.verificationUri, '_blank', 'noopener,noreferrer'); }
      }}>{t('plugin.market.open_auth')}</a>
      <Typography.Text type="secondary">{t('plugin.market.auth_pending')}</Typography.Text>
      <Button onClick={account.cancel}>{t('common.cancel')}</Button>
    </div>} />}
    {account.status === 'denied' || account.status === 'expired' ? <Alert showIcon type="warning" message={t('plugin.market.auth_' + account.status)} /> : null}
  </div>;
}
