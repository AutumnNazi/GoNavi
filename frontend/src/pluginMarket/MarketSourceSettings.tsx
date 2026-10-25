import { useEffect, useId, useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import type { MarketAccount } from './useMarketAccount';
import { safeHTTPURL } from './decode';

export function MarketSourceSettings({ account, allowed }: { account: MarketAccount; allowed: boolean }) {
  const { t } = useI18n();
  const inputId = useId();
  const [source, setSource] = useState(account.settings?.baseUrl ?? '');
  useEffect(() => { setSource(account.settings?.baseUrl ?? ''); }, [account.settings?.baseUrl]);
  const valid = !source.trim() || safeHTTPURL(source.trim());
  return <form className="plugin-market-source-settings" onSubmit={(event) => {
    event.preventDefault();
    if (allowed && !account.busy && valid) void account.configure(source.trim());
  }}>
    <Typography.Paragraph type="secondary">{t('plugin.market.source_hint')}</Typography.Paragraph>
    <label htmlFor={inputId}>{t('plugin.market.source')}</label>
    <Input id={inputId} value={source} onChange={(event) => setSource(event.target.value)}
      disabled={!allowed || account.busy} autoComplete="url" spellCheck={false} />
    <Button type="primary" htmlType="submit" loading={account.busy} disabled={!allowed || !valid}>
      {t('plugin.market.save_source')}
    </Button>
  </form>;
}
