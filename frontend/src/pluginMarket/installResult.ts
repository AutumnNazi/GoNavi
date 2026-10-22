import { PluginAPIError, pluginResult, requireRecord } from '../plugins/apiResult';
import { isRecord } from '../plugins/jsonBoundary';
import { decodeStatus } from '../plugins/decode';
import type { PluginStatus } from '../plugins/types';

export async function marketInstallResult(call: Promise<unknown>): Promise<PluginStatus> {
  const result = requireRecord(await call);
  if (result.success === false && isRecord(result.data) && result.data.provenanceRecorded === false) {
    decodeStatus(result.data.installed);
    throw new PluginAPIError('plugin.install.partial');
  }
  return pluginResult(Promise.resolve(result), decodeStatus);
}
