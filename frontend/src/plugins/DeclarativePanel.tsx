import { useMemo } from 'react';
import { Alert } from 'antd';
import { useI18n } from '../i18n/provider';
import { validateUINode } from './uiValidation';
import { DeclarativeNode } from './DeclarativeNode';
import type { JSONValue, PluginCommand } from './types';

interface Props {
  body: unknown;
  commands: PluginCommand[];
  disabled: boolean;
  invoke: (command: string, args: JSONValue) => void;
}
export function DeclarativePanel({ body, commands, disabled, invoke }: Props) {
  const { t } = useI18n();
  const node = useMemo(() => {
    try { return validateUINode(body, new Set(commands.map((command) => command.id))); }
    catch { return null; }
  }, [body, commands]);
  if (!node) return <Alert type="error" showIcon message={t('plugin.ui.invalid_schema')} />;
  return <DeclarativeNode node={node} disabled={disabled} invoke={invoke} />;
}
