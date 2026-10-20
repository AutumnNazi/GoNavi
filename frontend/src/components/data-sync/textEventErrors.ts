import { t as translate } from '../../i18n';

export const eventErrorTextKeys = {
  'event_errors.view': 'data_sync.event_errors.view',
  'event_errors.hide': 'data_sync.event_errors.hide',
  'event_errors.details': 'data_sync.event_errors.details',
  'event_errors.code': 'data_sync.event_errors.code',
  'event_errors.run_scope': 'data_sync.event_errors.run_scope',
  'event_errors.exact_scope': 'data_sync.event_errors.exact_scope',
  'event_errors.no_rows': 'data_sync.event_errors.no_rows',
} as const;

export const eventErrorTexts = (language: string) => Object.fromEntries(
  Object.entries(eventErrorTextKeys).map(([key, catalogKey]) => [key, translate(catalogKey, undefined, language)]),
) as Record<keyof typeof eventErrorTextKeys, string>;
