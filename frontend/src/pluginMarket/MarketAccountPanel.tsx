import { useState } from 'react';
import { Alert, Button, Popover, Space, Tag, Typography } from 'antd';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n/provider';
import type { MarketAccount } from './useMarketAccount';
import { MarketPublishModal } from './MarketPublishModal';
import { MarketSourceSettings } from './MarketSourceSettings';
import { BrowserOpenURL } from '../../wailsjs/runtime';

export function MarketAccountPanel({ account, allowed, onRefresh }: { account: MarketAccount; allowed: boolean; onRefresh: () => void }) {
  const { t } = useI18n();
  const [publishOpen, setPublishOpen] = useState(false);
  const source = account.settings?.baseUrl ?? '';
  return <div className="plugin-stack">
    <div className="plugin-market-account">
      <div className="plugin-market-source-info">
        <div className="plugin-market-source-name">
          <Typography.Text strong ellipsis title={source}>{source || t('plugin.market.no_source')}</Typography.Text>
          {account.settings?.trustedOfficial && <Tag color="success">{t('plugin.market.official')}</Tag>}
        </div>
        {account.settings && <Typography.Text type="secondary">{t(account.settings.authenticated ? 'plugin.market.signed_in' : 'plugin.market.signed_out')}</Typography.Text>}
      </div>
      <Space wrap className="plugin-market-account-actions">
        <Popover trigger="click" placement="bottomRight" title={t('plugin.market.source')}
          content={<MarketSourceSettings account={account} allowed={allowed} />}>
          <Button icon={<SettingOutlined aria-hidden />}>{t('plugin.market.source')}</Button>
        </Popover>
        <Button icon={<ReloadOutlined aria-hidden />} onClick={onRefresh} disabled={account.busy}>{t('plugin.action.refresh')}</Button>
        {account.settings?.authenticated
          ? <Button onClick={() => void account.logout()} disabled={!allowed || account.busy}>{t('plugin.market.sign_out')}</Button>
          : <Button type="primary" onClick={() => void account.start()} disabled={!allowed || !source || account.busy || Boolean(account.login)}>{t('plugin.market.sign_in')}</Button>}
        {account.settings?.authenticated && source && <Button disabled={!allowed || account.busy} onClick={() => setPublishOpen(true)}>{t('plugin.market.publish')}</Button>}
      </Space>
    </div>
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
    <MarketPublishModal open={publishOpen} onClose={() => setPublishOpen(false)} published={account.refresh} />
  </div>;
}
