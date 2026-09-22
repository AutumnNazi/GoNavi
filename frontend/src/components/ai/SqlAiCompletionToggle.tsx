import React from 'react';
import { Switch } from 'antd';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import { isSqlAiCompletionEnabled, setSqlAiCompletionEnabled } from '../../utils/sqlAiCompletionEnabled';

export default function SqlAiCompletionToggle() {
  const i18n = useOptionalI18n();
  const copy = (key: string) => i18n?.t(key) || catalogTranslate(key);
  const [enabled, setEnabled] = React.useState(isSqlAiCompletionEnabled);
  const label = copy('ai_settings.form.inline_completion_enabled');

  return (
    <div className="gonavi-sql-ai-completion-toggle">
      <div className="gonavi-sql-ai-completion-toggle-title">
        <span>{label}</span>
        <Switch
          checked={enabled}
          aria-label={label}
          onChange={(checked) => {
            setSqlAiCompletionEnabled(checked);
            setEnabled(checked);
          }}
        />
      </div>
      <div className="gonavi-ai-provider-cli-path-help">{copy('ai_settings.form.inline_completion_enabled_hint')}</div>
    </div>
  );
}
