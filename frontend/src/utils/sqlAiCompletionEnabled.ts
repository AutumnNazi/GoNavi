const SQL_AI_COMPLETION_STORAGE_KEY = 'gonavi.sql-ai-completion-enabled';

let memoryOverride: boolean | undefined;

function readStoredFlag(): string | null {
  try {
    return globalThis.localStorage?.getItem(SQL_AI_COMPLETION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** SQL editor model completions stay on until the user turns the switch off. */
export function isSqlAiCompletionEnabled(): boolean {
  if (memoryOverride !== undefined) return memoryOverride;
  const stored = readStoredFlag();
  if (stored === null) return true;
  return stored !== '0';
}

export function setSqlAiCompletionEnabled(enabled: boolean): void {
  memoryOverride = enabled;
  try {
    globalThis.localStorage?.setItem(SQL_AI_COMPLETION_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Private mode can reject storage. The in-memory switch still updates.
  }
}
