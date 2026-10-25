import { useState } from 'react';
import { Alert, Button, Input, Modal, Space, Typography } from 'antd';
import { useI18n } from '../i18n/provider';
import { pickPluginPackageFile } from '../components/pluginManager/pluginPackagePicker';
import { pluginErrorText } from '../plugins/apiResult';
import { marketAPI } from './api';
import type { MarketSubmission } from './types';

// The publish flow uploads a prebuilt archive through the ordinary submission
// pipeline; the service validates the package and publishes it without any
// local execution, so this modal only collects the path and shows the result.
export function MarketPublishModal({ open, onClose, published }: { open: boolean; onClose: () => void; published?: () => void }) {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MarketSubmission | null>(null);
  const reset = () => { setPath(''); setSource(''); setBusy(false); setError(''); setResult(null); };
  const pick = async () => {
    setError('');
    setResult(null);
    const picked = await pickPluginPackageFile(path);
    if (picked.status === 'selected') setPath(picked.path);
  };
  const trimmedSource = source.trim();
  const sourceInvalid = trimmedSource !== '' && !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/.test(trimmedSource);
  const submit = async () => {
    if (!path || busy || sourceInvalid) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const submission = await marketAPI.submit(path, trimmedSource);
      setResult(submission);
      published?.();
    } catch (cause) {
      setError(pluginErrorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return <Modal title={t('plugin.market.publish_title')} open={open} onCancel={() => { reset(); onClose(); }} footer={null} destroyOnClose>
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text type="secondary">{t('plugin.market.publish_hint')}</Typography.Text>
      <Space wrap>
        <Button onClick={() => void pick()} disabled={busy}>{t('plugin.market.publish_pick')}</Button>
        {path && <Typography.Text className="plugin-publish-path" copyable ellipsis={{ tooltip: path }} style={{ maxWidth: 320 }}>{path}</Typography.Text>}
      </Space>
      <Input
        aria-label={t('plugin.market.publish_source')}
        placeholder={t('plugin.market.publish_source_placeholder')}
        value={source}
        onChange={(event) => setSource(event.target.value)}
        maxLength={200}
        disabled={busy}
        status={sourceInvalid ? 'error' : undefined}
      />
      {sourceInvalid && <Typography.Text type="danger">{t('plugin.market.publish_source_invalid')}</Typography.Text>}
      {trimmedSource && !sourceInvalid && <Typography.Text type="secondary">{t('plugin.market.publish_source_hint')}</Typography.Text>}
      <Button type="primary" onClick={() => void submit()} loading={busy} disabled={!path || sourceInvalid}>
        {t('plugin.market.publish_submit')}
      </Button>
      {error && <Alert type="error" showIcon message={t('plugin.market.publish_failed')} description={error} />}
      {result && <Alert type="success" showIcon
        message={result.state === 'published' ? t('plugin.market.publish_success') : t('plugin.market.publish_state', { state: result.state })}
        description={<span className="plugin-publish-result">{result.pluginId} · {result.version}</span>} />}
    </Space>
  </Modal>;
}
