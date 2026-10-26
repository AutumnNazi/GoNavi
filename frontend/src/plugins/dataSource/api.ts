import { PluginDataSources } from '../../../wailsjs/go/app/App';
import { pluginResult } from '../apiResult';
import { decodePluginDataSources } from './decode';
export async function fetchPluginDataSources() {
  return pluginResult(PluginDataSources(), decodePluginDataSources);
}
