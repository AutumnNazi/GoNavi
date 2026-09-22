import { t } from '../../i18n';
import type { ExportProgressStatus } from '../../utils/exportProgress';

export interface ExportStatusMeta {
  label: string;
  border: string;
  bg: string;
  text: string;
}

export const resolveStatusMeta = (status: ExportProgressStatus): ExportStatusMeta => {
  const meta: Record<ExportProgressStatus, ExportStatusMeta> = {
    idle: { label: t('data_export.progress.status.idle'), border: 'rgba(148, 163, 184, 0.35)', bg: 'rgba(148, 163, 184, 0.12)', text: '#475467' },
    start: { label: t('data_export.progress.status.start'), border: 'rgba(59, 130, 246, 0.3)', bg: 'rgba(59, 130, 246, 0.12)', text: '#1d4ed8' },
    running: { label: t('data_export.progress.status.running'), border: 'rgba(16, 185, 129, 0.3)', bg: 'rgba(16, 185, 129, 0.14)', text: '#047857' },
    finalizing: { label: t('data_export.progress.status.finalizing'), border: 'rgba(249, 115, 22, 0.3)', bg: 'rgba(249, 115, 22, 0.12)', text: '#c2410c' },
    cancelling: { label: t('data_export.progress.status.cancelling'), border: 'rgba(239, 68, 68, 0.32)', bg: 'rgba(239, 68, 68, 0.12)', text: '#dc2626' },
    cancelled: { label: t('data_export.progress.status.cancelled'), border: 'rgba(148, 163, 184, 0.35)', bg: 'rgba(148, 163, 184, 0.12)', text: '#475467' },
    done: { label: t('data_export.progress.status.done'), border: 'rgba(34, 197, 94, 0.3)', bg: 'rgba(34, 197, 94, 0.14)', text: '#15803d' },
    error: { label: t('data_export.progress.status.error'), border: 'rgba(239, 68, 68, 0.32)', bg: 'rgba(239, 68, 68, 0.12)', text: '#dc2626' },
  };
  return meta[status] || meta.idle;
};

export const renderStatusPill = (status: ExportProgressStatus) => {
  const meta = resolveStatusMeta(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.text,
        fontSize: 12,
        lineHeight: 1.2,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
};
