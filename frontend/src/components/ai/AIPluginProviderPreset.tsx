import { ApiOutlined } from '@ant-design/icons';
import type { ProviderPreset } from './aiSettingsModalConfig';
export function pluginProviderPreset(type: string): ProviderPreset {
  return { key: type, label: type, labelKey: '', desc: '', descKey: 'plugin.ai_provider.catalog_hint', icon: <ApiOutlined />,
    color: '#64748b', backendType: type, defaultBaseUrl: '', defaultModel: '', models: [], authMode: 'api-key' };
}
