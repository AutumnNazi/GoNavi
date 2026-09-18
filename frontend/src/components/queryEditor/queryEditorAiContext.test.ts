import { afterEach, describe, expect, it } from 'vitest';

import { t as translate } from '../../i18n';
import {
  buildQueryEditorAiContextPrompt,
  buildQueryEditorAiContextPromptAsync,
} from './queryEditorAiContext';
import {
  resetDatabaseServerVersionCache,
  setDatabaseServerVersionQuery,
  ensureDatabaseServerVersion,
} from './queryEditorServerVersion';

describe('buildQueryEditorAiContextPrompt', () => {
  afterEach(() => {
    resetDatabaseServerVersionCache();
    setDatabaseServerVersionQuery(null);
  });

  it('interpolates the cached server version into the prompt', async () => {
    setDatabaseServerVersionQuery(async () => ({ success: true, message: '5.7.44-log' }));
    await ensureDatabaseServerVersion({
      id: 'mysql-legacy',
      config: { type: 'mysql', host: '127.0.0.1', port: 3306 },
    });

    expect(buildQueryEditorAiContextPrompt({
      id: 'mysql-legacy',
      name: 'legacy-shop',
      config: { type: 'mysql', host: '127.0.0.1' },
    }, 'shop')).toBe(translate('query_editor.ai_prompt.context', {
      type: 'mysql',
      name: '"legacy-shop"',
      database: '"shop"',
      version: '5.7.44-log',
    }));
  });

  it('falls back to the unknown-version label when the cache is empty', () => {
    expect(buildQueryEditorAiContextPrompt({
      id: 'mysql-legacy',
      name: 'legacy-shop',
      config: { type: 'mysql' },
    }, '')).toContain(translate('query_editor.ai_prompt.default_version'));
  });

  it('fetches the live server version before building the prompt', async () => {
    setDatabaseServerVersionQuery(async () => ({
      success: true,
      message: 'PostgreSQL 12.1 (KingbaseES V8 R6)',
    }));

    await expect(buildQueryEditorAiContextPromptAsync({
      id: 'kingbase-lab',
      name: 'kb-lab',
      config: { type: 'kingbase', host: '127.0.0.1' },
    }, 'test')).resolves.toBe(translate('query_editor.ai_prompt.context', {
      type: 'kingbase',
      name: '"kb-lab"',
      database: '"test"',
      version: 'PostgreSQL 12.1 (KingbaseES V8 R6)',
    }));
  });
});
