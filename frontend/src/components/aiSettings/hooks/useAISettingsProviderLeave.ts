import { useCallback, useEffect } from 'react';
import { type AISettingsLeaveGuard, withAISettingsLeaveGuard } from '../../../utils/aiSettingsLeaveGuard';
import type { UseAISettingsProviderEditingInput } from './useAISettingsProviderEditing';

export function useAISettingsProviderLeave(input: UseAISettingsProviderEditingInput) {
  const { confirmationZIndex, saveRunningRef, messageApi, t, providerDirtyRef, discardConfirmationRef, mountedRef, activeRef, resetProviderEditorSession, cancelDiscardRef, modalApi, onLeaveGuardChange, active } = input;
  const confirmProviderLeave = useCallback<AISettingsLeaveGuard>(() => {
      if (saveRunningRef.current) {
          void messageApi.warning(t('ai_settings.provider.wait_for_save'));
          return false;
      }
      if (!providerDirtyRef.current) return true;
      if (discardConfirmationRef.current) return discardConfirmationRef.current;
      const confirmation = new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (discard: boolean) => {
              if (settled) return;
              settled = true;
              if (discard && mountedRef.current && activeRef.current) resetProviderEditorSession();
              cancelDiscardRef.current = null;
              resolve(discard && mountedRef.current && activeRef.current);
          };
          cancelDiscardRef.current = () => finish(false);
          modalApi.confirm({
              title: t('ai_settings.provider.discard_title'),
              content: t('ai_settings.provider.discard_hint'),
              centered: true,
              zIndex: confirmationZIndex,
              okText: t('ai_settings.provider.discard'),
              cancelText: t('ai_settings.provider.keep_editing'),
              onOk: () => finish(true),
              onCancel: () => finish(false),
              afterClose: () => finish(false),
          });
      }).finally(() => { discardConfirmationRef.current = null; });
      discardConfirmationRef.current = confirmation;
      return confirmation;
  }, [confirmationZIndex, messageApi, modalApi, resetProviderEditorSession, t]);

  useEffect(() => {
      onLeaveGuardChange?.(active ? confirmProviderLeave : null);
      return () => onLeaveGuardChange?.(null);
  }, [active, confirmProviderLeave, onLeaveGuardChange]);

  const handleCancelProviderEdit = () => withAISettingsLeaveGuard(confirmProviderLeave, resetProviderEditorSession);

  useEffect(() => {
      if (!active) {
          resetProviderEditorSession();
      }
  }, [active, resetProviderEditorSession]);
  return { confirmProviderLeave, handleCancelProviderEdit };
}
