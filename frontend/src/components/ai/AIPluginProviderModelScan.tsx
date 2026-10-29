import { useMemo, useState } from 'react';
import { invokeAccountCommand, parseScanAccountModels } from './aiPluginProviderAccountApi';

type CopyText = (key: string, params?: Record<string, string | number>) => string;

interface AIPluginProviderModelScanProps {
  pluginId?: string;
  t: CopyText;
  selected: string[];
  onChange: (models: string[]) => void;
  /** Saves the provider right here so the model list never needs the footer. */
  onSave?: () => void;
  saving?: boolean;
}

// One bubble per model, toggled by click: the union of every key's model list,
// because each key group reaches a different set on the gateway.
export default function AIPluginProviderModelScan({ pluginId, t, selected, onChange, onSave, saving }: AIPluginProviderModelScanProps) {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string[]>(() => selected);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? scanned.filter((id) => id.toLowerCase().includes(needle)) : scanned;
  }, [scanned, query]);

  const scan = async () => {
    if (!pluginId || scanning) return;
    setScanning(true);
    setMessage('');
    const outcome = await invokeAccountCommand(pluginId, 'account.listModels', parseScanAccountModels);
    setScanning(false);
    if (outcome.kind !== 'ok') {
      setMessage(outcome.kind === 'error' && outcome.message ? outcome.message : t('plugin.ai_provider.models_scan_failed'));
      return;
    }
    setScanned(outcome.data);
    if (outcome.data.length === 0) setMessage(t('plugin.ai_provider.models_scan_empty'));
    // Everything reachable is selected on the first scan; the user trims it down.
    else onChange(outcome.data);
  };

  const toggle = (id: string) => {
    onChange(chosen.has(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };

  return (
    <div className="gn-model-scan">
      <div className="gn-model-scan-head">
        {scanned.length > 0 && (
          <span className="gn-model-scan-count">
            {t('plugin.ai_provider.models_scan_count', { count: selected.length, total: scanned.length })}
          </span>
        )}
        <span className="gn-model-scan-actions">
          {scanned.length > 0 && (
            <>
              <button type="button" className="gn-model-scan-link" onClick={() => onChange(scanned)}>
                {t('plugin.ai_provider.models_all')}
              </button>
              <button type="button" className="gn-model-scan-link" onClick={() => onChange([])}>
                {t('plugin.ai_provider.models_none')}
              </button>
            </>
          )}
          <button type="button" className="gn-model-scan-button" disabled={!pluginId || scanning} onClick={() => void scan()}>
            {t(scanning ? 'plugin.ai_provider.models_scan_running' : 'plugin.ai_provider.models_scan')}
          </button>
          {onSave && (
            <button type="button" className="gn-model-scan-save" disabled={selected.length === 0 || Boolean(saving)} onClick={onSave}>
              {t('plugin.ai_provider.models_save')}
            </button>
          )}
        </span>
      </div>
      {scanned.length > 0 && (
        <label className="gn-model-scan-search">
          <input
            type="search"
            value={query}
            placeholder={t('plugin.ai_provider.models_filter')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {visible.length > 0 && (
        <div className="gn-model-chips">
          {visible.map((id) => (
            <button
              type="button"
              key={id}
              className={chosen.has(id) ? 'gn-model-chip is-on' : 'gn-model-chip'}
              aria-pressed={chosen.has(id)}
              onClick={() => toggle(id)}
            >
              {chosen.has(id) && <span className="gn-model-chip-check" aria-hidden="true">✓</span>}
              {id}
            </button>
          ))}
        </div>
      )}
      {message && <p className="gn-model-scan-message" role="alert">{message}</p>}
    </div>
  );
}
