import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/useSidebarObjectActions.tsx', import.meta.url), 'utf8');
const dropRoutineSource = source.slice(
  source.indexOf('const handleDropRoutine ='),
  source.indexOf('const resolveMessagePublishTarget ='),
);
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;

describe('Sidebar drop routine confirm i18n', () => {
  it('localizes the drop routine confirm dialog and feedback copy', () => {
    expect(dropRoutineSource).toContain('const handleDropRoutine =');
    expect(dropRoutineSource).not.toContain('const typeLabel = routineType === \'PROCEDURE\' ? \'存储过程\' : \'函数\';');
    expect(dropRoutineSource).not.toContain('title: `确认删除${typeLabel}`');
    expect(dropRoutineSource).not.toContain('content: `确定删除${typeLabel} "${routineName}" 吗？该操作不可恢复。`');
    expect(dropRoutineSource).not.toContain('message.success(`${typeLabel}删除成功`)');
    expect(dropRoutineSource).not.toContain('message.error("删除失败: " + res.message)');
    expect(dropRoutineSource).toContain("title: t('sidebar.modal.confirm_delete_routine.title'");
    expect(dropRoutineSource).toContain("content: t('sidebar.modal.confirm_delete_routine.content'");
    expect(dropRoutineSource).toContain("message.success(t('sidebar.message.routine_deleted'");
    expect(dropRoutineSource).toContain("message.error(t('sidebar.message.delete_failed'");
    expect(dropRoutineSource).toContain("t(routineType === 'PROCEDURE' ? 'sidebar.object.procedure' : 'sidebar.object.function')");
  });

  it('keeps drop routine catalog placeholders aligned', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      expect(catalog['sidebar.modal.confirm_delete_routine.title'], `${locale}:title`).toContain('{{type}}');
      expect(catalog['sidebar.modal.confirm_delete_routine.content'], `${locale}:content type`).toContain('{{type}}');
      expect(catalog['sidebar.modal.confirm_delete_routine.content'], `${locale}:content name`).toContain('{{name}}');
      expect(catalog['sidebar.message.routine_deleted'], `${locale}:routine deleted`).toContain('{{type}}');
      expect(catalog['sidebar.message.delete_failed'], `${locale}:delete failed`).toContain('{{error}}');
    });
  });
});
