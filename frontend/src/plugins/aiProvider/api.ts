import { PluginAIProviders } from '../../../wailsjs/go/app/App';
import { pluginResult } from '../apiResult';
import { decodePluginAIProviders } from './decode';
export const fetchPluginAIProviders = () => pluginResult(PluginAIProviders(), decodePluginAIProviders);
