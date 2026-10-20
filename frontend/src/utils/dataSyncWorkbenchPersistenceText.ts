import { t } from '../i18n';

export const formatSavedTaskPreflightFailure = (error: unknown): string =>
  t('data_sync.workbench.saved_preflight_failed', {
    detail: error instanceof Error ? error.message : String(error),
  });
