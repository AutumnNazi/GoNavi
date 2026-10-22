import { normalizeProviderPresetKey, findPreset, getProviderPresetMode, localizeProviderPreset } from '../../ai/aiSettingsModalConfig';
import { getSingletonCLIIdentity, resolvePresetTransport, resolvePresetModelSelection, resolvePresetBaseURL } from '../../../utils/aiProviderPresets';
import type { AIProviderConfig } from '../../../types';
import { recordFromRows } from '../../../utils/aiProviderKeyValue';
import { isProviderSecretRequirementSatisfied, resolveProviderSecretDraft, canRetainExistingProviderSecret } from '../../../utils/providerSecretDraft';
import { normalizeProviderModels } from '../../../utils/aiProviderManagement';
import { usePluginProviderCatalog } from '../../../plugins/aiProvider/context';
import { isPluginAIProviderNamespace } from '../../../plugins/aiProvider/identity';
import { buildPluginProviderPayload } from '../../../plugins/aiProvider/editor';
import type { UseAISettingsProviderEditingInput } from './useAISettingsProviderEditing';
export type ProviderPayloadBuilder = (values: Record<string, unknown>, purpose: 'save' | 'test') => AIProviderConfig;

export function useAISettingsProviderPayload(input: UseAISettingsProviderEditingInput) {
  const { t, providers, editingProvider, form } = input;
  const catalog = usePluginProviderCatalog();
  const buildProviderPayload = (values: Record<string, any>, purpose: 'save' | 'test'): AIProviderConfig => {
      // validateFields only returns mounted fields. Removed controls must not
      // leak legacy values back into a saved provider.
      values = { ...form.getFieldsValue(true), ...values };
      if (isPluginAIProviderNamespace(values.type ?? editingProvider?.type)) return buildPluginProviderPayload(values, editingProvider, purpose, catalog?.find(values.type ?? editingProvider?.type));
      const { headerRows, cliEnvRows, models: _removedModels, maxTokens: _removedMaxTokens, ...formFields } = values;
      const presetKey = normalizeProviderPresetKey(values.presetKey || 'openai');
      const preset = findPreset(presetKey);
      const selectedMode = getProviderPresetMode(preset, formFields.connectionMode);
      const connectionPreset = selectedMode || preset;
      const resolutionKey = selectedMode?.legacyPresetKey || presetKey;
      const openAICodexSubscription = presetKey === 'openai' && formFields.authMode === 'local-cli';
      const authMode = openAICodexSubscription || connectionPreset.authMode === 'local-cli'
          ? 'local-cli'
          : (formFields.authMode === 'bearer' ? 'bearer' : 'api-key');
      const { model } = resolvePresetModelSelection({
          presetKey: openAICodexSubscription ? 'codex' : resolutionKey,
          presetDefaultModel: connectionPreset.defaultModel || '',
          presetModels: connectionPreset.models || [],
          valuesModel: values.model,
          customModels: [],
      });
      const baseUrl = openAICodexSubscription ? '' : resolvePresetBaseURL({
          presetKey: resolutionKey,
          presetDefaultBaseUrl: connectionPreset.defaultBaseUrl,
          presetEndpoints: connectionPreset.endpoints,
          valuesBaseUrl: values.baseUrl,
      });
      const transport = openAICodexSubscription ? { type: 'custom' as const, apiFormat: 'codex-cli' } : resolvePresetTransport({
          presetKey: resolutionKey,
          presetBackendType: connectionPreset.backendType,
          presetFixedApiFormat: connectionPreset.fixedApiFormat,
          presetDefaultApiFormat: connectionPreset.defaultApiFormat,
          presetEndpoints: connectionPreset.endpoints,
          valuesBaseUrl: baseUrl,
          valuesApiFormat: values.apiFormat,
          valuesModel: model,
      });
      const apiKeyInput = authMode === 'local-cli' ? '' : values.apiKey;
      if (!isProviderSecretRequirementSatisfied({ apiKeyInput, currentAuthMode: authMode, editingProvider, allowEmptySecret: presetKey === 'codebuddy' || presetKey === 'gonavi-ai' })) {
          throw new Error(t(purpose === 'test' ? 'ai_settings.message.test_requires_new_api_key' : 'ai_settings.form.api_key_required'));
      }
      const secret = resolveProviderSecretDraft({
          apiKeyInput,
          retainExistingSecret: !String(apiKeyInput || '').trim() && canRetainExistingProviderSecret({ currentAuthMode: authMode, editingProvider }),
      });
      const payload = {
          ...editingProvider,
          ...formFields,
          ...transport,
          name: String(values.name || '').trim() ? values.name : localizeProviderPreset(preset, t).label,
          apiKey: secret.apiKey,
          hasSecret: secret.hasSecret,
          authMode,
          baseUrl,
          model,
          models: [],
          disabledModels: normalizeProviderModels(values.disabledModels),
          customModels: normalizeProviderModels(values.customModels),
          effort: authMode === 'local-cli' ? String(values.effort || '') : '',
          inlineCompletionModel: String(values.inlineCompletionModel || '').trim(),
          maxTokens: 0,
          temperature: Number.isFinite(Number(values.temperature)) ? Number(values.temperature) : 0.7,
          // 供应商的上下文档位：按当前模型校验，落不到可选档位就回默认（0）
          contextWindow: Math.max(0, Math.trunc(Number(values.contextWindow) || 0)),
          headers: authMode === 'local-cli' ? {} : recordFromRows(headerRows),
          cliPath: authMode === 'local-cli' ? String(values.cliPath || '').trim() : '',
          cliEnv: authMode === 'local-cli' ? recordFromRows(cliEnvRows) : {},
      } as AIProviderConfig;
      if (payload.disabledModels?.includes(model) || (payload.inlineCompletionModel && payload.disabledModels?.includes(payload.inlineCompletionModel))) {
          throw new Error(t('ai_settings.models.required_disabled'));
      }
      const identity = getSingletonCLIIdentity(payload);
      if (identity && (!editingProvider?.id || getSingletonCLIIdentity(editingProvider) !== identity)
          && providers.some((provider) => provider.id !== payload.id && getSingletonCLIIdentity(provider) === identity)) {
          throw new Error(t('ai_settings.provider.duplicate_cli'));
      }
      return payload;
  };
  return { buildProviderPayload };
}
