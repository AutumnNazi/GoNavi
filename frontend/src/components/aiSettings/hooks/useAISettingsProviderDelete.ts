
import type { UseAISettingsProviderEditingInput } from './useAISettingsProviderEditing';

export function useAISettingsProviderDelete(input: UseAISettingsProviderEditingInput) {
  const { messageApi, t, resetProviderEditorSession, editorSessionRef, resolveAIService, committedProviderRef, editingProvider, loadProviders } = input;
  const handleDeleteProvider = async (id: string) => {
      const session = editorSessionRef.current;
      try {
          const Service = await resolveAIService();
          if (typeof Service?.AIDeleteProvider !== 'function') throw new Error(t('ai_settings.message.bridge_unavailable'));
          const wasActive = id === committedProviderRef.current;
          await Service.AIDeleteProvider(id);
          if (session === editorSessionRef.current && editingProvider?.id === id) resetProviderEditorSession();
          await loadProviders();
          // 合并提示：删除的是当前激活的供应商时，附带自动切换信息
          if (wasActive) {
              const newProviders: any[] = await Service?.AIGetProviders?.() || [];
              if (newProviders.length > 0) {
                  const newActiveName = newProviders[0]?.name || t('ai_settings.provider.next_provider');
                  void messageApi.success(t('ai_settings.message.deleted_and_switched', { name: newActiveName }));
              } else {
                  void messageApi.success(t('ai_settings.message.deleted'));
              }
          } else {
              void messageApi.success(t('ai_settings.message.deleted'));
          }
          window.dispatchEvent(new CustomEvent('gonavi:ai:provider-changed'));
      } catch (e: any) { void messageApi.error(e?.message || t('ai_settings.message.delete_failed')); }
  };
  return { handleDeleteProvider };
}
