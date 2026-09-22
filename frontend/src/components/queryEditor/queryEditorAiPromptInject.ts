import { useStore } from '../../store';
import { t } from '../../i18n';
import {
  buildQueryEditorAiContextPromptAsync,
  type QueryEditorAiPromptConnection,
} from './queryEditorAiContext';
import type { SavedConnection } from '../../types';

const AI_PROMPT_INJECT_EVENT = 'gonavi:ai:inject-prompt';

export const dispatchQueryEditorAiPrompt = (
  prompt: string,
  delayMs = 0,
  autoSend = false,
): void => {
  const store = useStore.getState();
  if (!store.aiPanelVisible) {
    store.setAIPanelVisible(true);
  }
  const fire = () => {
    window.dispatchEvent(new CustomEvent(AI_PROMPT_INJECT_EVENT, { detail: { prompt, autoSend } }));
  };
  if (delayMs > 0) {
    window.setTimeout(fire, delayMs);
    return;
  }
  fire();
};

/** 一键 AI 诊断：把实际执行的 SQL 与错误注入 AI 面板（结果区按钮与快捷键共用）。 */
export const diagnoseExecutionErrorWithAI = async (
  sql: string,
  error: string,
  connectionId?: string,
  database = '',
): Promise<void> => {
  const store = useStore.getState();
  const headline = [database.trim(), error.split('\n')[0]?.trim() || '']
    .filter(Boolean)
    .join(' · ')
    .slice(0, 80);
  await injectQueryEditorAiPromptWithContext({
    connection: store.connections.find((item) => item.id === String(connectionId || '').trim()),
    database,
    prompt: t('query_editor.ai_prompt.diagnose', { sql, error }),
    headline,
    delayIfPanelClosedMs: 350,
    autoSend: true,
  });
};

export const injectQueryEditorAiPromptWithContext = async (options: {
  connection?: QueryEditorAiPromptConnection | SavedConnection | null;
  database: string;
  prompt: string;
  headline?: string;
  delayIfPanelClosedMs?: number;
  autoSend?: boolean;
}): Promise<void> => {
  const store = useStore.getState();
  const delayMs = !store.aiPanelVisible && options.delayIfPanelClosedMs
    ? options.delayIfPanelClosedMs
    : 0;
  if (!store.aiPanelVisible) store.setAIPanelVisible(true);
  const ctxText = await buildQueryEditorAiContextPromptAsync(options.connection, options.database);
  const headline = String(options.headline || '').trim();
  const prompt = `${headline ? `${headline}\n` : ''}${ctxText}${options.prompt}`;
  dispatchQueryEditorAiPrompt(prompt, delayMs, options.autoSend === true);
};
