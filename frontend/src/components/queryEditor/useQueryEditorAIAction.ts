import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import type { SavedConnection } from '../../types';
import { isGlobalShortcutCaptureActive, isShortcutMatch, resolveShortcutBinding, type ShortcutOptions, type ShortcutPlatform } from '../../utils/shortcuts';
import { injectQueryEditorAiPromptWithContext } from './queryEditorAiPromptInject';

type AIAction = 'generate' | 'explain' | 'optimize' | 'schema';

export function useQueryEditorAIAction(options: {
  isActive: boolean;
  shortcuts: ShortcutOptions;
  platform: ShortcutPlatform;
  getSelection: () => string;
  getSQL: () => string;
  placeholder: string;
  connection: SavedConnection | undefined;
  database: string;
  openGenerate: () => void;
}) {
  const action = (kind: AIAction) => {
    if (kind === 'generate') { options.openGenerate(); return; }
    const sql = options.getSelection() || options.getSQL() || options.placeholder;
    void injectQueryEditorAiPromptWithContext({
      connection: options.connection,
      database: options.database,
      prompt: t(`query_editor.ai_prompt.${kind}`, { sql }),
    });
  };
  const latestAction = useRef(action);
  latestAction.current = action;
  const binding = resolveShortcutBinding(options.shortcuts, 'optimizeQueryWithAI', options.platform);
  useEffect(() => {
    if (!options.isActive || !binding.enabled || !binding.combo) return;
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isGlobalShortcutCaptureActive() || !isShortcutMatch(event, binding.combo)) return;
      event.preventDefault();
      latestAction.current('optimize');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [options.isActive, binding.enabled, binding.combo]);
  return action;
}
