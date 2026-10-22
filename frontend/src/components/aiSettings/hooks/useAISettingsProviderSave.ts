import { v4 as uuidv4 } from 'uuid';
import { PluginAPIError } from '../../../plugins/apiResult';
import { hasPluginProviderHeaderSecret, pluginProviderCopyHeaders } from '../../../plugins/aiProvider/copyHeaders';
import { getSingletonCLIIdentity } from '../../../utils/aiProviderPresets';
import { buildEditProviderEditorSession } from '../../../utils/aiProviderEditorState';
import { providerCopyName } from '../../../utils/aiProviderManagement';
import type { ProviderPayloadBuilder } from './useAISettingsProviderPayload';
import { isPluginAIProviderNamespace } from '../../../plugins/aiProvider/identity';
import type { UseAISettingsProviderEditingInput } from './useAISettingsProviderEditing';

export function useAISettingsProviderSave(input: UseAISettingsProviderEditingInput, buildProviderPayload: ProviderPayloadBuilder) {
  const { saveRunningRef, messageApi, t, mountedRef, activeRef, providers, applyProviderEditorSession, editorSessionRef, invalidateProviderTest, resolveAIService, editingProvider, loadProviders, form, configRevisionRef, setProviderSaveMode, setProviderSaving, setEditingProvider, providerBaselineRef, refreshProviderDirty } = input;
  const handleSaveProvider = async (mode: 'save' | 'copy' = 'save') => {
      if (saveRunningRef.current) return;
      saveRunningRef.current = true;
      const session = editorSessionRef.current;
      const revision = configRevisionRef.current;
      const isCurrent = () => mountedRef.current && activeRef.current && session === editorSessionRef.current;
      const draftUnchanged = () => {
          if (!isCurrent()) return false;
          if (revision === configRevisionRef.current) return true;
          void messageApi.warning(t('ai_settings.provider.draft_changed'));
          return false;
      };
      setProviderSaveMode(mode);
      setProviderSaving(true);
      try {
          const values = await form.validateFields();
          if (!draftUnchanged()) return;
          const draft = { ...form.getFieldsValue(true), ...values };
          let payload = buildProviderPayload(values, 'save');
          if (mode === 'copy' && (!editingProvider?.id || getSingletonCLIIdentity(payload))) {
              throw new Error(t('ai_settings.provider.copy_cli_unavailable'));
          }
          const Service = await resolveAIService();
          if (!draftUnchanged()) return;
          if (typeof Service?.AISaveProvider !== 'function') throw new Error(t('ai_settings.message.bridge_unavailable'));
          if (mode === 'copy') {
              // Secret metadata belongs to the old ID. Resolve it through the
              // existing editable-config interface before saving under a new
              // ID; never put credentials in browser storage or the clipboard.
              if (typeof Service.AIGetEditableProvider !== 'function') throw new Error(t('ai_settings.provider.copy_secret_unavailable'));
              const original = await Service.AIGetEditableProvider(editingProvider!.id);
              if (!draftUnchanged()) return;
              if (!original || original.id !== editingProvider!.id || (isPluginAIProviderNamespace(payload.type) && original.type !== payload.type)) throw new Error(t('ai_settings.provider.copy_secret_unavailable'));
              const apiKey = payload.apiKey || original.apiKey || '';
              const pluginCopy = isPluginAIProviderNamespace(payload.type);
              if (payload.hasSecret && !apiKey && (!pluginCopy || (original.hasSecret && !hasPluginProviderHeaderSecret(original.headers)))) throw new Error(t('ai_settings.provider.copy_secret_unavailable'));
              const copiedHeaders = pluginCopy ? pluginProviderCopyHeaders(original.headers, payload.headers) : { ...original.headers, ...payload.headers };
              payload = {
                  ...payload,
                  id: `provider-${uuidv4()}`,
                  name: providerCopyName(payload.name, providers.map((provider) => provider.name), t('ai_settings.provider.copy_suffix')),
                  apiKey,
                  headers: copiedHeaders,
                  hasSecret: pluginCopy ? Boolean(apiKey || hasPluginProviderHeaderSecret(copiedHeaders)) : payload.hasSecret,
                  secretRef: undefined,
              };
          } else if (!payload.id) payload = { ...payload, id: `provider-${uuidv4()}` };
          await Service.AISaveProvider(payload);
          if (isCurrent()) {
              if (revision === configRevisionRef.current) {
                  applyProviderEditorSession(buildEditProviderEditorSession({
                      provider: { ...payload, presetKey: draft.presetKey },
                      formValues: { ...draft, ...payload },
                  }));
              } else if (mode === 'save') {
                  // A newer draft remains editable after this snapshot saves.
                  // Adopt the new ID so retrying a first save cannot duplicate it.
                  setEditingProvider(payload);
                  form.setFieldValue('id', payload.id);
                  providerBaselineRef.current = { ...draft, id: payload.id };
                  refreshProviderDirty();
                  invalidateProviderTest();
              }
              void messageApi.success(t(mode === 'copy' ? 'ai_settings.provider.copied' : 'ai_settings.message.saved'));
          }
          if (mountedRef.current) void loadProviders();
          window.dispatchEvent(new CustomEvent('gonavi:ai:provider-changed'));
      } catch (error: any) {
          if (isCurrent() && !error?.errorFields) void messageApi.error(error instanceof PluginAPIError ? t(error.key) : error?.message || String(error) || t('ai_settings.message.save_failed'));
      } finally {
          saveRunningRef.current = false;
          if (mountedRef.current) setProviderSaving(false);
      }
  };
  return { handleSaveProvider };
}
