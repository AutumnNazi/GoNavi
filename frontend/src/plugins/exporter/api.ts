import { PluginExporters } from '../../../wailsjs/go/app/App';
import { pluginResult } from '../apiResult';
import { decodePluginExporters } from './decode';
export const fetchPluginExporters = () => pluginResult(PluginExporters(), decodePluginExporters);
