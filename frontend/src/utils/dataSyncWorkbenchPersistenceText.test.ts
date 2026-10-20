import { afterEach, describe, expect, it } from 'vitest';
import { getCurrentLanguage, setCurrentLanguage, t, type SupportedLanguage } from '../i18n';
import { formatSavedTaskPreflightFailure } from './dataSyncWorkbenchPersistenceText';

const initialLanguage = getCurrentLanguage();
const prefixes: Record<SupportedLanguage, string> = {
  'zh-CN': '任务已保存，但保存后的预检失败：',
  'zh-TW': '任務已儲存，但儲存後的預檢失敗：',
  'en-US': 'The task was saved, but the post-save preflight failed: ',
  'ja-JP': 'タスクは保存されましたが、保存後の事前チェックに失敗しました：',
  'de-DE': 'Die Aufgabe wurde gespeichert, aber die anschließende Vorprüfung ist fehlgeschlagen: ',
  'ru-RU': 'Задача сохранена, но предварительная проверка после сохранения завершилась ошибкой: ',
};

afterEach(() => setCurrentLanguage(initialLanguage));

describe('saved task preflight failure text', () => {
  it.each(Object.entries(prefixes) as [SupportedLanguage, string][])(
    'formats the %s error using shared catalog interpolation', (language, prefix) => {
      setCurrentLanguage(language);
      const detail = 'permission denied: <orders> & "customer"';
      const message = formatSavedTaskPreflightFailure(new Error(detail));
      expect(message).toBe(`${prefix}${detail}`);
      expect(message).toBe(t('data_sync.workbench.saved_preflight_failed', { detail }));
      expect(message).not.toContain('{{detail}}');
    },
  );

  it('converts non-Error failures and reads the latest language at call time', () => {
    setCurrentLanguage('en-US');
    expect(formatSavedTaskPreflightFailure('timeout')).toBe(`${prefixes['en-US']}timeout`);
    setCurrentLanguage('ru-RU');
    expect(formatSavedTaskPreflightFailure(504)).toBe(`${prefixes['ru-RU']}504`);
  });
});
