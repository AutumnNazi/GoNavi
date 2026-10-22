import { withAISettingsLeaveGuard } from '../../../utils/aiSettingsLeaveGuard';
import { type ProviderEndpointType, getProviderEndpointTypes, resolveProviderEndpointConnection, getProviderEndpointType } from '../../../utils/aiProviderEndpoints';
import { normalizeProviderPresetKey, findPreset, getProviderPresetMode } from '../../ai/aiSettingsModalConfig';
import { getSingletonCLIIdentity } from '../../../utils/aiProviderPresets';
import { buildAddProviderEditorSession } from '../../../utils/aiProviderEditorState';
import type { AISettingsLeaveGuard } from '../../../utils/aiSettingsLeaveGuard';
import { usePluginProviderCatalog } from '../../../plugins/aiProvider/context';
import { isPluginAIProviderNamespace } from '../../../plugins/aiProvider/identity';
import { newPluginProviderSession } from '../../../plugins/aiProvider/editor';
import type { UseAISettingsProviderEditingInput } from './useAISettingsProviderEditing';

export function useAISettingsProviderAdd(input: UseAISettingsProviderEditingInput, confirmProviderLeave: AISettingsLeaveGuard) {
  const { messageApi, t, providers, applyProviderEditorSession } = input;
  const catalog = usePluginProviderCatalog();
  const handleAddProvider = (presetKey = 'openai', endpointType?: ProviderEndpointType) => withAISettingsLeaveGuard(confirmProviderLeave, () => {
      if (isPluginAIProviderNamespace(presetKey)) {
          const source = catalog?.find(presetKey);
          if (!source) { void messageApi.warning(t('plugin.ai_provider.error.unavailable')); return; }
          applyProviderEditorSession(newPluginProviderSession(source)); return;
      }
      const normalizedPresetKey = normalizeProviderPresetKey(presetKey);
      const preset = findPreset(normalizedPresetKey);
      const requestedMode = (presetKey !== normalizedPresetKey ? preset.modes?.find((mode) => mode.legacyPresetKey === presetKey) : undefined)
          || (endpointType ? preset.modes?.find((mode) => getProviderEndpointTypes({ ...mode, key: `${preset.key}:${mode.key}` }).includes(endpointType)) : undefined)
          || getProviderPresetMode(preset);
      const connectionPreset = requestedMode || preset;
      const connection = resolveProviderEndpointConnection(connectionPreset, endpointType || getProviderEndpointType({
          type: connectionPreset.backendType, apiFormat: connectionPreset.fixedApiFormat || connectionPreset.defaultApiFormat,
      }) || 'openai');
      if (!connection) return;
      const identity = getSingletonCLIIdentity({ type: connectionPreset.backendType, apiFormat: connectionPreset.fixedApiFormat, authMode: connectionPreset.authMode });
      if (identity && providers.some((provider) => getSingletonCLIIdentity(provider) === identity)) {
          void messageApi.error(t('ai_settings.provider.duplicate_cli'));
          return;
      }
      applyProviderEditorSession(buildAddProviderEditorSession({
          presetKey: normalizedPresetKey,
          presetBackendType: connection.type,
          presetBaseUrl: connection.baseUrl,
          presetModel: connectionPreset.defaultModel || '',
          apiFormat: connection.apiFormat,
          authMode: connectionPreset.authMode || 'api-key',
          connectionMode: requestedMode?.key,
      }));
  });

  const handleApplyPartnerBaseUrl = (baseUrl: string, label: string) => withAISettingsLeaveGuard(confirmProviderLeave, () => {
      const preset = findPreset('custom');
      const session = buildAddProviderEditorSession({
          presetKey: preset.key,
          presetBackendType: preset.backendType,
          presetBaseUrl: baseUrl,
          presetModel: '',
          apiFormat: 'openai',
          authMode: 'api-key',
      });
      if (session.formValues) session.formValues = { ...session.formValues, name: label };
      applyProviderEditorSession(session);
      void messageApi.success(t('ai_settings.provider.partner.base_url_applied'));
  });
  return { handleAddProvider, handleApplyPartnerBaseUrl };
}
