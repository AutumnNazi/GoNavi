import React from 'react';
import { Progress } from 'antd';

import {
  resolveExportProgressPercent,
  shouldUseIndeterminateExportProgress,
  type ExportProgressStatus,
} from '../utils/exportProgress';

const INDETERMINATE_ANIMATION_NAME = 'gonavi-export-indeterminate-progress';

const normalizeCount = (value: unknown): number => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) {
    return 0;
  }
  return Math.trunc(next);
};

type ExportProgressBarProps = {
  status: ExportProgressStatus;
  current: number;
  total: number;
  totalRowsKnown: boolean;
};

export const ExportProgressBar: React.FC<ExportProgressBarProps> = ({
  status,
  current,
  total,
  totalRowsKnown,
}) => {
  const isIndeterminate = shouldUseIndeterminateExportProgress(status, total, totalRowsKnown);
  const progressStatus = status === 'error'
    ? 'exception'
    : (status === 'done' ? 'success' : (status === 'cancelled' ? 'normal' : 'active'));

  if (isIndeterminate) {
    return (
      <div data-export-progress-mode="indeterminate">
        <style>{`
          @keyframes ${INDETERMINATE_ANIMATION_NAME} {
            0% { transform: translateX(-130%); }
            100% { transform: translateX(430%); }
          }
        `}</style>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 8,
            overflow: 'hidden',
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.08)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: '24%',
              borderRadius: 999,
              background: '#1677ff',
              animation: `${INDETERMINATE_ANIMATION_NAME} 1.25s ease-in-out infinite`,
            }}
          />
        </div>
      </div>
    );
  }

  const percent = resolveExportProgressPercent(status, current, total, totalRowsKnown);
  return (
    <div data-export-progress-mode="determinate">
      <Progress
        percent={Math.round(percent)}
        status={progressStatus}
        format={() => totalRowsKnown
          ? `${normalizeCount(current)}/${normalizeCount(total)}`
          : `${Math.round(percent)}%`}
      />
    </div>
  );
};

export default ExportProgressBar;
