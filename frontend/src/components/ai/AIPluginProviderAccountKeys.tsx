import { useMemo, useState } from 'react';
import { Button } from 'antd';
import { formatAccountTime, maskAccountKey, type AccountKeyItem } from './aiPluginProviderAccountApi';
import type { AccountKeysView } from './useAccountKeys';

type CopyText = (key: string, params?: Record<string, string | number>) => string;

interface AIPluginProviderAccountKeysProps {
  keys: AccountKeysView;
  t: CopyText;
}

const groupLabel = (item: AccountKeyItem, t: CopyText): string => {
  if (!item.groupName) return '';
  if (item.rateMultiplier === undefined) return item.groupName;
  return t('plugin.ai_provider.account.group_multiplier', { group: item.groupName, rate: item.rateMultiplier });
};

const quotaLabel = (item: AccountKeyItem, t: CopyText): string => {
  if (!item.quota) return t('plugin.ai_provider.account.keys_unlimited');
  const used = item.quotaUsed ?? 0;
  return t('plugin.ai_provider.account.quota_used_total', { used, total: item.quota });
};

const writeClipboard = async (text: string): Promise<boolean> => {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

// Two quiet lines per key: identity plus actions, then the facts joined by separators.
// A table would need six columns in a form that is barely 700px wide.
export default function AIPluginProviderAccountKeys({ keys, t }: AIPluginProviderAccountKeysProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);

  const items = useMemo(() => keys.items ?? [], [keys.items]);

  const onCopy = (item: AccountKeyItem) => {
    void (async () => {
      const ok = await writeClipboard(item.key);
      setCopyState({ id: item.id, ok });
    })();
  };

  if (keys.state === 'error') {
    return (
      <div className="gn-account-keys-error" role="alert">
        {t('plugin.ai_provider.account.keys_error', { message: keys.message || t('plugin.ai_provider.account.action_failed') })}
      </div>
    );
  }

  return (
    <div className="gn-account-keys">
      <div className="gn-account-keys-head">
        <span className="gn-account-keys-title">{t('plugin.ai_provider.account.keys_title')}</span>
        {items.length > 0 && <span className="gn-account-keys-count">{items.length}</span>}
      </div>

      {items.length === 0 ? (
        <p className="gn-account-keys-empty">{t('plugin.ai_provider.account.keys_empty')}</p>
      ) : (
        <ul className="gn-account-key-list">
          {items.map((item) => {
            const id = item.id || item.key;
            const copied = Boolean(copyState && copyState.id === item.id && copyState.ok);
            const failed = Boolean(copyState && copyState.id === item.id && !copyState.ok);
            const group = groupLabel(item, t);
            return (
              <li className="gn-account-key" key={id}>
                <div className="gn-account-key-top">
                  <span className="gn-account-key-name" title={item.name || item.id}>{item.name || item.id}</span>
                  <span className="gn-account-key-actions">
                    <Button
                      size="small"
                      type="text"
                      onClick={() => setRevealed((current) => ({ ...current, [item.id]: !current[item.id] }))}
                    >
                      {t(revealed[item.id] ? 'plugin.ai_provider.account.keys_hide' : 'plugin.ai_provider.account.keys_show')}
                    </Button>
                    <Button size="small" type="text" onClick={() => onCopy(item)}>
                      {t(copied ? 'plugin.ai_provider.account.keys_copied' : 'plugin.ai_provider.account.keys_copy')}
                    </Button>
                  </span>
                </div>
                <div className="gn-account-key-line">
                  <code className="gn-account-key-value">{revealed[item.id] ? item.key : maskAccountKey(item.key)}</code>
                  {group && <><span className="gn-account-key-sep">·</span><span className="gn-account-key-group">{group}</span></>}
                  {item.status && item.status !== 'active' && (
                    <><span className="gn-account-key-sep">·</span><span className="gn-account-key-inactive">{item.status}</span></>
                  )}
                  <span className="gn-account-key-sep">·</span>
                  <span className="gn-account-key-fact">{quotaLabel(item, t)}</span>
                  <span className="gn-account-key-sep">·</span>
                  <span className="gn-account-key-fact">
                    {formatAccountTime(item.lastUsedAt) || t('plugin.ai_provider.account.keys_never')}
                  </span>
                  {failed && <span className="gn-account-key-failed">{t('plugin.ai_provider.account.keys_copy_failed')}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
