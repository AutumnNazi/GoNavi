import React from 'react';
import { Alert, Button, Progress, Space, Typography } from 'antd';
import type { MockDataRunOutcome } from './hooks/useMockDataRun';
import type { MockDataProgress } from './mockDataModel';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export type MockDataRunPanelProps = {
  running: boolean;
  progress: MockDataProgress | null;
  outcome: MockDataRunOutcome | null;
  t: Translate;
  onCancel: () => void;
  onDismiss: () => void;
};

const MAX_ERROR_LINES = 20;

/** 写入进度与结果。失败时列出前若干条错误，方便定位是哪批数据被数据库拒绝。 */
export const MockDataRunPanel: React.FC<MockDataRunPanelProps> = ({ running, progress, outcome, t, onCancel, onDismiss }) => {
  if (running && progress) {
    const total = Math.max(progress.total || 0, 1);
    const done = progress.success + progress.errors;
    return (
      <div className="gn-mock-data-run-panel" data-mock-data-running="true">
        <Progress percent={Math.min(100, Math.floor((done / total) * 100))} status="active" />
        <Space className="gn-mock-data-run-meta">
          <Typography.Text>{t('mock_data.run.progress', { done, total, failed: progress.errors })}</Typography.Text>
          <Button size="small" danger onClick={onCancel}>{t('mock_data.run.cancel')}</Button>
        </Space>
      </div>
    );
  }
  if (!outcome) return null;
  const data = outcome.data;
  const type = outcome.success ? 'success' : (data?.cancelled ? 'warning' : 'error');
  const errorLogs = (data?.errorLogs || []).slice(0, MAX_ERROR_LINES);
  return (
    <div className="gn-mock-data-run-panel">
      <Alert
        type={type}
        showIcon
        closable
        onClose={onDismiss}
        message={outcome.message}
        description={data ? (
          <div>
            <Typography.Text type="secondary">
              {t('mock_data.run.summary', { success: data.success, failed: data.failed, total: data.total, seconds: (data.durationMs / 1000).toFixed(1) })}
            </Typography.Text>
            {data.outcomeUnknown ? <div><Typography.Text type="warning">{t('mock_data.run.outcome_unknown')}</Typography.Text></div> : null}
            {errorLogs.length > 0 ? (
              <pre className="gn-mock-data-error-logs">{errorLogs.join('\n')}</pre>
            ) : null}
          </div>
        ) : null}
      />
    </div>
  );
};
