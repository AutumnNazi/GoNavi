import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DataSyncRunHistory } from './DataSyncOperationalViews';
import type { DataSyncRunRecord } from './model';
import { createDataSyncWorkbenchTranslate } from './text';

const run = (rollbackReady: boolean): DataSyncRunRecord => ({
  id: 'sync-run-1',
  taskId: 'task-1',
  taskName: 'Orders',
  status: 'succeeded',
  trigger: 'manual',
  attempt: 1,
  resumable: false,
  message: '',
  startedAt: '2026-10-12T00:00:00.000Z',
  finishedAt: '2026-10-12T00:01:00.000Z',
  rowsRead: 0,
  rowsWritten: 1,
  rowsFailed: 0,
  throughput: 0,
  checkpoint: '',
  rollbackReady,
});

const renderHistory = (record: DataSyncRunRecord, onRollback?: (runId: string) => void) => renderToStaticMarkup(
  <DataSyncRunHistory
    runs={[record]}
    runPage={1}
    runPageSize={10}
    runTotal={1}
    hasPreviousRunPage={false}
    hasNextRunPage={false}
    selectedRunId={record.id}
    runEvents={[]}
    errorRows={[]}
    compareResult={null}
    t={createDataSyncWorkbenchTranslate('zh-CN')}
    checkpoint={null}
    busyAction=""
    onRefresh={() => undefined}
    onPreviousRunPage={() => undefined}
    onNextRunPage={() => undefined}
    onRunPageSizeChange={() => undefined}
    onDeleteRun={() => undefined}
    onRollback={onRollback}
    onClearTerminalRuns={() => undefined}
    onSelectRun={() => undefined}
    onCancel={() => undefined}
    onResume={() => undefined}
    onRetry={() => undefined}
    onDiscardErrorRow={() => undefined}
    errorRowRetryAvailable={false}
    onRetryErrorRow={() => undefined}
    checkpointResetEnabled={false}
    onResetCheckpoint={() => undefined}
  />,
);

describe('DataSyncRunHistory rollback', () => {
  it('offers rollback only for a terminal run that has a snapshot', () => {
    const onRollback = vi.fn();
    const ready = renderHistory(run(true), onRollback);
    expect(ready).toContain('data-data-sync-rollback-run="sync-run-1"');
    expect(ready).toContain('回滚到任务前');

    const missing = renderHistory(run(false), onRollback);
    expect(missing).not.toContain('data-data-sync-rollback-run');
  });
});
