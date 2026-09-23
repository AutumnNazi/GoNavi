import { t as translate } from '../../i18n';

export const backupTextKeys = {
  'task_kind.backup': 'data_sync.backup.title',
  'task_kind.backup_desc': 'data_sync.backup.description',
  'validation.backup_directory_required': 'data_sync.backup.directory_required',
  'stage.backup_source': 'data_sync.backup.source_label',
  'stage.backup_objects': 'data_sync.backup.objects',
  'stage.backup_output': 'data_sync.backup.directory',
  'backup.run_mode': 'data_sync.backup.run_mode',
  'backup.full_snapshot_help': 'data_sync.backup.full_snapshot_help',
} as const;

export const backupTexts = (language: string): Record<keyof typeof backupTextKeys, string> =>
  Object.fromEntries(Object.entries(backupTextKeys).map(([key, catalogKey]) =>
    [key, translate(catalogKey, undefined, language)],
  )) as Record<keyof typeof backupTextKeys, string>;
