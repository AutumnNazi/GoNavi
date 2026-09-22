import { getCurrentLanguage, t } from '../i18n';

export type ExportProgressStatus = 'idle' | 'start' | 'running' | 'finalizing' | 'cancelling' | 'done' | 'error' | 'cancelled';

const hasUsableExportTotal = (total: number, totalRowsKnown: boolean): boolean => {
  const normalizedTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  return totalRowsKnown && normalizedTotal > 0;
};

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
};

export const shouldUseExactExportProgress = (
  status: ExportProgressStatus,
  total: number,
  totalRowsKnown: boolean,
): boolean => {
  if (hasUsableExportTotal(total, totalRowsKnown)) {
    return true;
  }
  if ((status === 'done' || status === 'error') && hasUsableExportTotal(total, totalRowsKnown)) {
    return true;
  }
  return false;
};

export const shouldUseIndeterminateExportProgress = (
  status: ExportProgressStatus,
  total: number,
  totalRowsKnown: boolean,
): boolean => !hasUsableExportTotal(total, totalRowsKnown) && status !== 'idle' && status !== 'done' && status !== 'error' && status !== 'cancelled';

export const resolveExportProgressPercent = (
  status: ExportProgressStatus,
  current: number,
  total: number,
  totalRowsKnown: boolean,
): number => {
  const normalizedCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const normalizedTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  if (hasUsableExportTotal(total, totalRowsKnown)) {
    return clampPercent((normalizedCurrent / normalizedTotal) * 100);
  }
  if ((status === 'done' || status === 'error') && (totalRowsKnown || normalizedCurrent >= 0)) {
    return 100;
  }
  return 0;
};

export const formatExportProgressRows = (
  current: number,
  total: number,
  totalRowsKnown: boolean,
): string => {
  const formatter = new Intl.NumberFormat(getCurrentLanguage());
  const safeCurrent = formatter.format(Math.max(0, Math.trunc(Number(current) || 0)));
  if (!hasUsableExportTotal(total, totalRowsKnown)) {
    return t('data_export.progress.rows_written', { current: safeCurrent });
  }
  const safeTotal = formatter.format(Math.max(0, Math.trunc(Number(total) || 0)));
  return t('data_export.progress.rows_written_with_total', {
    current: safeCurrent,
    total: safeTotal,
  });
};

export const resolveExportElapsedMs = (
  startedAt: number,
  finishedAt = 0,
  now = Date.now(),
): number => {
  const safeStartedAt = Number(startedAt);
  if (!Number.isFinite(safeStartedAt) || safeStartedAt <= 0) {
    return 0;
  }
  const safeFinishedAt = Number(finishedAt);
  const endAt = Number.isFinite(safeFinishedAt) && safeFinishedAt > 0
    ? safeFinishedAt
    : Number(now);
  if (!Number.isFinite(endAt) || endAt <= safeStartedAt) {
    return 0;
  }
  return Math.max(0, Math.trunc(endAt - safeStartedAt));
};

const padTimePart = (value: number): string => String(Math.max(0, Math.trunc(value))).padStart(2, '0');

export const formatExportElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.trunc(Number(elapsedMs) / 1000));
  const hours = Math.trunc(totalSeconds / 3600);
  const minutes = Math.trunc((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${padTimePart(hours)}:${padTimePart(minutes)}:${padTimePart(seconds)}`;
  }
  return `${padTimePart(minutes)}:${padTimePart(seconds)}`;
};
