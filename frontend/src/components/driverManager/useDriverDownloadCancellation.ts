import { useCallback, useRef, type MutableRefObject } from 'react';
import { message } from 'antd';

import { t } from '../../i18n';
import type { DriverProgressState } from '../../utils/driverProgress';
import { CancelDriverPackageDownload } from '../../../wailsjs/go/app/App';
import {
  canCancelDriverDownload,
  createDriverBatchCancellation,
  createDriverInstallSessions,
  listActiveDriverDownloadCancelTargets,
  normalizeDriverDownloadTaskSnapshot,
  normalizeDriverTypeKey,
  resolveDriverDownloadCancelTarget,
  type DriverBatchCancellation,
  type DriverDownloadCancelIntents,
  type DriverDownloadTaskSnapshot,
  type DriverInstallSessions,
} from './driverDownloadCancellation';

export type UseDriverDownloadCancellationParams = {
  progressTaskIdMapRef: MutableRefObject<Record<string, string>>;
  progressMapRef: MutableRefObject<Record<string, DriverProgressState>>;
  cancelIntents: DriverDownloadCancelIntents;
  applyDriverDownloadTaskSnapshot: (task: DriverDownloadTaskSnapshot) => boolean;
  updateDriverProgress: (driverType: string, incoming: DriverProgressState) => DriverProgressState | undefined;
  appendOperationLog: (driverType: string, text: string, signature?: string) => void;
  resolveDriverErrorMessage: (rawMessage: unknown, fallbackMessage: string) => string;
  onReleaseInstallAction?: (driverType: string) => void;
};

export type UseDriverDownloadCancellationResult = {
  batchCancellation: DriverBatchCancellation;
  cancelIntents: DriverDownloadCancelIntents;
  installSessions: DriverInstallSessions;
  /** Cancels the visible install immediately, then the backend task if it exists. */
  cancelDriverDownload: (driverType: string, driverName: string) => Promise<boolean>;
  /** Cancels a known backend task, optionally without toasts (batch flows). */
  cancelDriverDownloadTask: (
    driverType: string,
    taskId: string,
    driverName: string,
    options?: { silentToast?: boolean },
  ) => Promise<boolean>;
  /** Stops the batch queue and cancels every in-progress install. */
  cancelAllDriverDownloads: (resolveDriverName: (driverType: string) => string) => Promise<void>;
};

export const useDriverDownloadCancellation = ({
  progressTaskIdMapRef,
  progressMapRef,
  cancelIntents,
  applyDriverDownloadTaskSnapshot,
  updateDriverProgress,
  appendOperationLog,
  resolveDriverErrorMessage,
  onReleaseInstallAction,
}: UseDriverDownloadCancellationParams): UseDriverDownloadCancellationResult => {
  const batchCancellationRef = useRef<DriverBatchCancellation>(createDriverBatchCancellation());
  const installSessionsRef = useRef<DriverInstallSessions>(createDriverInstallSessions());

  const markLocalCanceled = useCallback((
    driverType: string,
    driverName: string,
    options?: { silentToast?: boolean },
  ) => {
    const normalized = normalizeDriverTypeKey(driverType);
    installSessionsRef.current.begin(normalized);
    onReleaseInstallAction?.(normalized);
    cancelIntents.request(normalized);
    const previous = progressMapRef.current[normalized];
    updateDriverProgress(normalized, {
      status: 'canceled',
      message: t('driver_manager.progress.download_canceled'),
      percent: previous?.percent || 0,
    });
    const canceledText = t('driver_manager.message.download_canceled_named', { name: driverName });
    appendOperationLog(driverType, canceledText);
    if (!options?.silentToast) {
      message.info(canceledText);
    }
  }, [appendOperationLog, cancelIntents, onReleaseInstallAction, progressMapRef, updateDriverProgress]);

  const cancelDriverDownloadTask = useCallback(async (
    driverType: string,
    taskId: string,
    driverName: string,
    options?: { silentToast?: boolean },
  ): Promise<boolean> => {
    const fallbackMessage = t('driver_manager.message.download_cancel_failed', { name: driverName, detail: '' });
    try {
      const result = await CancelDriverPackageDownload(taskId);
      if (!result?.success) {
        const errText = resolveDriverErrorMessage(result?.message, fallbackMessage);
        appendOperationLog(driverType, `[ERROR] ${errText}`);
        if (!options?.silentToast) {
          message.error(errText);
        }
        return false;
      }
      const task = normalizeDriverDownloadTaskSnapshot((result.data as { task?: unknown } | undefined)?.task);
      if (task) {
        applyDriverDownloadTaskSnapshot(task);
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error || '');
      const errText = t('driver_manager.message.download_cancel_failed', { name: driverName, detail });
      appendOperationLog(driverType, `[ERROR] ${errText}`);
      if (!options?.silentToast) {
        message.error(errText);
      }
      return false;
    }
  }, [appendOperationLog, applyDriverDownloadTaskSnapshot, resolveDriverErrorMessage]);

  const cancelDriverDownload = useCallback(async (driverType: string, driverName: string): Promise<boolean> => {
    if (!canCancelDriverDownload(progressMapRef.current, driverType)) {
      return false;
    }
    const taskId = resolveDriverDownloadCancelTarget(progressTaskIdMapRef.current, progressMapRef.current, driverType);
    markLocalCanceled(driverType, driverName);
    if (!taskId) {
      return true;
    }
    return cancelDriverDownloadTask(driverType, taskId, driverName, { silentToast: true });
  }, [cancelDriverDownloadTask, markLocalCanceled, progressMapRef, progressTaskIdMapRef]);

  const cancelAllDriverDownloads = useCallback(async (resolveDriverName: (driverType: string) => string): Promise<void> => {
    batchCancellationRef.current.request();
    const targets = listActiveDriverDownloadCancelTargets(progressTaskIdMapRef.current, progressMapRef.current);
    await Promise.all(targets.map(({ driverType, taskId }) => {
      markLocalCanceled(driverType, resolveDriverName(driverType), { silentToast: true });
      return taskId
        ? cancelDriverDownloadTask(driverType, taskId, resolveDriverName(driverType), { silentToast: true })
        : Promise.resolve(true);
    }));
  }, [cancelDriverDownloadTask, markLocalCanceled, progressMapRef, progressTaskIdMapRef]);

  return {
    batchCancellation: batchCancellationRef.current,
    cancelIntents,
    installSessions: installSessionsRef.current,
    cancelDriverDownload,
    cancelDriverDownloadTask,
    cancelAllDriverDownloads,
  };
};
