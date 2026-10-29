import { useEffect, useMemo, useState } from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import { useModelDevContexts } from '../../plugins/aiProvider/useModelDevContexts';
import { contextTiersFor, formatContextWindow, parseContextWindow, snapContextWindow } from '../../plugins/aiProvider/modelDevContexts';

// Context window as tier bubbles instead of a free number: models.dev decides the
// tiers a selected model can reach, and a typed 1M / 1000000 lands on the same tier.
export default function AIPluginProviderContextPicker({
  modelIds, value, onChange,
}: {
  modelIds: string[];
  value?: number;
  onChange: (value: number) => void;
}) {
  const t = useOptionalI18n()?.t ?? translate;
  const contexts = useModelDevContexts();
  const tiers = useMemo(() => contextTiersFor(contexts, modelIds), [contexts, modelIds]);
  const current = snapContextWindow(value ?? 0);
  const [draft, setDraft] = useState(formatContextWindow(value));
  useEffect(() => { setDraft(formatContextWindow(value)); }, [value]);

  const commit = () => {
    const parsed = parseContextWindow(draft);
    if (parsed === null) {
      setDraft(formatContextWindow(value));
      return;
    }
    setDraft(formatContextWindow(parsed));
    onChange(parsed);
  };

  return (
    <div className="gn-context-picker">
      <span className="gn-context-label">{t('plugin.ai_provider.context')}</span>
      <div className="gn-context-chips">
        {tiers.map((tier) => (
          <button
            type="button"
            key={tier}
            className={current === tier ? 'gn-context-chip is-on' : 'gn-context-chip'}
            aria-pressed={current === tier}
            onClick={() => onChange(tier)}
          >
            {formatContextWindow(tier)}
          </button>
        ))}
        <input
          className="gn-context-input"
          value={draft}
          placeholder={t('plugin.ai_provider.context_placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
        />
      </div>
    </div>
  );
}
