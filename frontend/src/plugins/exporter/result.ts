import { isRecord } from '../jsonBoundary';
import { t } from '../../i18n';
import type { ExportRunResult } from '../../components/useExportProgressRunner';
const CODES = new Set(['invalid_selection', 'unsupported_options', 'unsupported_scope', 'invalid_snapshot', 'unavailable', 'invalid_job', 'busy', 'destination_failed', 'render_failed', 'write_failed', 'commit_unknown']);
/** Full export error keys behind the dynamic lookup, kept literal for the i18n invariant. */
export const PLUGIN_EXPORT_ERROR_KEYS = [
  'plugin_export.error.invalid_selection',
  'plugin_export.error.unsupported_options',
  'plugin_export.error.unsupported_scope',
  'plugin_export.error.invalid_snapshot',
  'plugin_export.error.unavailable',
  'plugin_export.error.invalid_job',
  'plugin_export.error.busy',
  'plugin_export.error.destination_failed',
  'plugin_export.error.render_failed',
  'plugin_export.error.write_failed',
  'plugin_export.error.commit_unknown',
] as const;
export function safePluginExportResult<T extends ExportRunResult>(result: T): T {
  if (result.success) return result;
  const data = isRecord(result.data) ? result.data : {};
  if (data.outcomeUnknown === true) return { ...result, message: t('plugin_export.error.commit_unknown') };
  if (data.canceled === true) return result;
  const code = typeof data.code === 'string' && CODES.has(data.code) ? data.code : 'render_failed';
  return { ...result, message: t('plugin_export.error.' + code) };
}
