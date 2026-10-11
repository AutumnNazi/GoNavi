import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { EventsOn } from '../../../../wailsjs/runtime/runtime';
import { confirmProductionRisk } from '../../../utils/productionRiskConfirm';
import {
  cancelMockDataJob,
  generateMockData,
  previewMockData,
} from '../mockDataApi';
import {
  createMockDataJobId,
  MOCK_DATA_PROGRESS_EVENT,
  type MockDataPreviewResult,
  type MockDataProgress,
  type MockDataRunResult,
} from '../mockDataModel';
import type { MockDataSetup } from './useMockDataSetup';

export type MockDataPreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
  data?: MockDataPreviewResult;
};

export type MockDataRunOutcome = {
  success: boolean;
  message: string;
  data?: MockDataRunResult;
};

export type MockDataRun = ReturnType<typeof useMockDataRun>;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 预览与写入。写入前二次确认（含生产环境倒计时确认），进度经 mockdata:progress 按 jobId 过滤。 */
export const useMockDataRun = (setup: MockDataSetup) => {
  const { t, target, plan, connection, continueOnError } = setup;
  const [preview, setPreview] = useState<MockDataPreviewState>({ status: 'idle' });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MockDataProgress | null>(null);
  const [outcome, setOutcome] = useState<MockDataRunOutcome | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => () => {
    // 关掉标签页即取消仍在跑的写入，不留后台任务。
    if (jobIdRef.current) cancelMockDataJob(jobIdRef.current);
  }, []);

  const runPreview = useCallback(async () => {
    if (!target) return;
    const requestId = ++previewRequestRef.current;
    setPreview((current) => ({ ...current, status: 'loading', message: undefined }));
    try {
      const result = await previewMockData(target, plan);
      if (requestId !== previewRequestRef.current) return;
      setPreview(result.success && result.data
        ? { status: 'ready', data: result.data }
        : { status: 'error', message: result.message || t('mock_data.preview.failed') });
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setPreview({ status: 'error', message: errorText(error) });
    }
  }, [plan, t, target]);

  const confirmWrite = useCallback(async (): Promise<boolean> => {
    const approved = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: t('mock_data.run.confirm_title'),
        content: t('mock_data.run.confirm_content', { count: plan.rowCount, table: target?.tableName || '' }),
        okText: t('mock_data.run.confirm_ok'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!approved) return false;
    return confirmProductionRisk({
      connection,
      action: t('mock_data.run.production_action'),
      target: [target?.dbName, target?.tableName].filter(Boolean).join('.'),
      translate: t,
    });
  }, [connection, plan.rowCount, t, target]);

  const runGenerate = useCallback(async () => {
    if (!target || running) return;
    if (!(await confirmWrite())) return;
    const jobId = createMockDataJobId();
    jobIdRef.current = jobId;
    setRunning(true);
    setOutcome(null);
    setProgress({ jobId, current: 0, total: plan.rowCount, success: 0, errors: 0 });
    const unsubscribe = EventsOn(MOCK_DATA_PROGRESS_EVENT, (data: MockDataProgress) => {
      if (!data || data.jobId !== jobId) return;
      setProgress({ jobId, current: data.current, total: data.total || plan.rowCount, success: data.success, errors: data.errors });
    });
    try {
      const result = await generateMockData(target, plan, { jobId, continueOnError });
      setOutcome({ success: result.success, message: result.message, data: result.data });
    } catch (error) {
      setOutcome({ success: false, message: errorText(error) });
    } finally {
      unsubscribe?.();
      jobIdRef.current = null;
      setRunning(false);
    }
  }, [confirmWrite, continueOnError, plan, running, target]);

  const cancel = useCallback(() => {
    if (jobIdRef.current) cancelMockDataJob(jobIdRef.current);
  }, []);

  return { preview, runPreview, running, progress, outcome, runGenerate, cancel, clearOutcome: () => setOutcome(null) };
};
