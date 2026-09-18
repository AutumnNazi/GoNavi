import { useStore } from '../../store';
import { t } from '../../i18n';
import {
  buildQueryEditorAiContextPromptAsync,
  type QueryEditorAiPromptConnection,
} from './queryEditorAiContext';
import type { SavedConnection } from '../../types';

const AI_PROMPT_INJECT_EVENT = 'gonavi:ai:inject-prompt';

export const dispatchQueryEditorAiPrompt = (prompt: string, delayMs = 0): void => {
  const store = useStore.getState();
  if (!store.aiPanelVisible) {
    store.setAIPanelVisible(true);
  }
  const fire = () => {
    window.dispatchEvent(new CustomEvent(AI_PROMPT_INJECT_EVENT, { detail: { prompt } }));
  };
  if (delayMs > 0) {
    window.setTimeout(fire, delayMs);
    return;
  }
  fire();
};

/** 一键 AI 诊断：把当前 SQL 与执行错误注入 AI 面板（结果区按钮与快捷键共用）。 */
export const diagnoseExecutionErrorWithAI = (sql: string, error: string): void => {
  const prompt = t('query_editor.ai_prompt.diagnose', { sql, error });
  const store = useStore.getState();
  const delayMs = !store.aiPanelVisible ? 350 : 0;
  dispatchQueryEditorAiPrompt(prompt, delayMs);
};

export const injectQueryEditorAiPromptWithContext = async (options: {
  connection?: QueryEditorAiPromptConnection | SavedConnection | null;
  database: string;
  prompt: string;
  delayIfPanelClosedMs?: number;
}): Promise<void> => {
  const store = useStore.getState();
  const delayMs = !store.aiPanelVisible && options.delayIfPanelClosedMs
    ? options.delayIfPanelClosedMs
    : 0;
  const ctxText = await buildQueryEditorAiContextPromptAsync(options.connection, options.database);
  dispatchQueryEditorAiPrompt(`${ctxText}${options.prompt}`, delayMs);
};
