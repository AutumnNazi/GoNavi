import type { AISafetyLevel, AIContextLevel } from '../../../types';
import type { UseAISettingsProviderEditingInput } from './useAISettingsProviderEditing';

export function useAISettingsProviderPreferences(input: UseAISettingsProviderEditingInput) {
  const { messageApi, t, mountedRef, active, resolveAIService, committedProviderRef, switchRunningRef, switchTargetRef, setPendingProviderId, providerLoadSequenceRef, setProvidersLoading, setActiveProviderId, setSafetyLevel, resultMaskingLoadError, resultMaskingSaving, setResultMaskingSaving, setResultMaskingSaveError, resultMaskingSettings, setContextLevel, setRunPolicyError, loadConfig } = input;
  const handleSetActive = async (id: string) => {
      if (!switchRunningRef.current && id === committedProviderRef.current) return;
      switchTargetRef.current = id;
      setPendingProviderId(id);
      if (switchRunningRef.current) return;
      switchRunningRef.current = true;
      // Invalidate an older list read before any active-provider write starts.
      providerLoadSequenceRef.current++;
      setProvidersLoading(false);
      try {
          while (switchTargetRef.current !== null && mountedRef.current) {
              const target = switchTargetRef.current;
              switchTargetRef.current = null;
              if (target === committedProviderRef.current) continue;
              try {
                  const Service = await resolveAIService();
                  if (!mountedRef.current) break;
                  if (typeof Service?.AISetActiveProvider !== 'function') throw new Error(t('ai_settings.message.bridge_unavailable'));
                  await Service.AISetActiveProvider(target);
                  committedProviderRef.current = target;
                  providerLoadSequenceRef.current++;
                  if (mountedRef.current) {
                      setProvidersLoading(false);
                      setActiveProviderId(target);
                      if (switchTargetRef.current === null) void messageApi.success(t('ai_settings.message.switched'));
                  }
                  window.dispatchEvent(new CustomEvent('gonavi:ai:provider-changed'));
              } catch (error: any) {
                  if (mountedRef.current) void messageApi.error(error?.message || String(error) || t('ai_settings.message.switch_failed'));
              }
          }
      } finally {
          switchRunningRef.current = false;
          if (mountedRef.current) setPendingProviderId('');
      }
  };

  const handleSafetyChange = async (level: AISafetyLevel) => {
      try {
          const Service = (window as any).go?.aiservice?.Service;
          await Service?.AISetSafetyLevel?.(level);
          setSafetyLevel(level);
      } catch (e) { /* ignore */ }
  };

  const handleSaveResultMasking = async () => {
      if (resultMaskingLoadError || resultMaskingSaving) return;
      setResultMaskingSaving(true);
      setResultMaskingSaveError('');
      try {
          const Service = await resolveAIService();
          if (typeof Service?.AISaveResultMaskingSettings !== 'function') {
              throw new Error(t('ai_settings.result_masking.save_failed'));
          }
          await Service.AISaveResultMaskingSettings(resultMaskingSettings);
          if (mountedRef.current) void messageApi.success(t('ai_settings.result_masking.saved'));
      } catch (error: any) {
          const detail = error?.message || String(error) || t('ai_settings.result_masking.save_failed');
          if (mountedRef.current) {
              setResultMaskingSaveError(detail);
              void messageApi.error(detail);
          }
      } finally {
          if (mountedRef.current) setResultMaskingSaving(false);
      }
  };

  const handleContextChange = async (level: AIContextLevel) => {
      try {
          const Service = (window as any).go?.aiservice?.Service;
          await Service?.AISetContextLevel?.(level);
          setContextLevel(level);
      } catch (e) { /* ignore */ }
  };

  const handleReloadRunPolicy = () => {
      setRunPolicyError('');
      void loadConfig();
  };
  return { handleSetActive, handleSafetyChange, handleSaveResultMasking, handleContextChange, handleReloadRunPolicy };
}
