import { subscribePluginContributionInvalidation } from '../invalidation';
import { isWebRuntime } from '../../utils/browserFileTransfer';
import { parsePluginExporterFormat } from './identity';
import { exporterError } from './validation';
import type { PluginExportOperation } from './types';
export function beginPluginExportOperation(format: string): PluginExportOperation {
  const identity = parsePluginExporterFormat(format); if (!identity || isWebRuntime()) return exporterError('unavailable');
  let current = true;
  const unsubscribe = subscribePluginContributionInvalidation((event) => { if (event.reason === 'root' || !event.pluginId || event.pluginId === identity.pluginId) current = false; });
  return { isCurrent: () => current && !isWebRuntime(), release: () => { current = false; unsubscribe(); } };
}
