import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DataSyncRunDetailsModal } from './DataSyncRunDetailsModal';
import { hasRunEventError, resolveRunEventError } from './dataSyncEventErrors';
import { createDataSyncWorkbenchTranslate } from './text';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import type { DataSyncErrorRow, DataSyncRunEvent } from './model';

vi.mock('../common/ResizableDraggableModal', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const event = (changes: Partial<DataSyncRunEvent> = {}): DataSyncRunEvent => ({
  runId: 'r1', sequence: 1, type: 'error_row', message: 'duplicate key',
  payload: { id: 'row1', errorCode: '23505' }, createdAt: '', ...changes,
});
const row = (id: string, runId = 'r1'): DataSyncErrorRow => ({
  id, runId, taskId: 'task', mappingId: 'map', sourceObject: 'orders', reason: `reason-${id}`,
  payloadPreview: `payload-${id}`, retryable: false, status: 'pending', operation: 'insert',
});
const rows = [row('row1'), row('row2'), row('row1', 'r2')];
const props = (): DataSyncRunHistoryProps => ({
  runs: [], runPage: 1, runPageSize: 10, runTotal: 0, hasPreviousRunPage: false, hasNextRunPage: false,
  selectedRunId: 'r1', selectedRunMessage: 'unrelated run message', runEvents: [event()], errorRows: rows,
  compareResult: null, checkpoint: null, busyAction: '', t: createDataSyncWorkbenchTranslate('en-US'),
  onSelectRun: vi.fn(), onRefresh: vi.fn(), onPreviousRunPage: vi.fn(), onNextRunPage: vi.fn(),
  onRunPageSizeChange: vi.fn(), onDeleteRun: vi.fn(), onClearTerminalRuns: vi.fn(), onCancel: vi.fn(),
  onResume: vi.fn(), onRetry: vi.fn(), onDiscardErrorRow: vi.fn(), errorRowRetryAvailable: false,
  onRetryErrorRow: vi.fn(), checkpointResetEnabled: false, onResetCheckpoint: vi.fn(),
});

describe('on-demand event errors', () => {
  it('hides details and rows by default, expands the exact row, and closes on run switch/reopen', () => {
    const input = props();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<DataSyncRunDetailsModal {...input} />); });
    expect(renderer.root.findAllByProps({ 'data-data-sync-error-rows': 'true' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('23505');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('duplicate key');
    const button = () => renderer.root.findByProps({ 'data-view-event-error': 1 });
    expect(button().children).toEqual(['View error']);
    act(() => button().props.onClick());
    expect(button().props['aria-expanded']).toBe(true);
    const details = renderer.root.findByProps({ 'data-event-error-details': 1 });
    expect(details.findByProps({ 'data-event-error-code': '23505' })).toBeTruthy();
    expect(details.findAllByType('tbody')[0].findAllByType('tr')).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('reason-row2');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('unrelated run message');
    act(() => button().props.onClick());
    expect(renderer.root.findAllByProps({ 'data-event-error-details': 1 })).toHaveLength(0);
    act(() => button().props.onClick());
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} selectedRunId="r2" runEvents={[event({ runId: 'r2' })]} />));
    expect(renderer.root.findAllByProps({ 'data-event-error-details': 1 })).toHaveLength(0);
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} selectedRunId="" />));
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} />));
    expect(button().props['aria-expanded']).toBe(false);
    act(() => renderer.unmount());
  });

  it.each([undefined, '{"error":"permission denied"}'])('shows non-row terminal failures without inventing a code (%s)', (payload) => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<DataSyncRunDetailsModal {...props()} errorRows={[]}
      runEvents={[event({ type: 'failed', message: 'connection refused', payload })]} />); });
    act(() => renderer.root.findByProps({ 'data-view-event-error': 1 }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('connection refused');
    if(payload) expect(JSON.stringify(renderer.toJSON())).toContain('permission denied');
    expect(renderer.root.findAll((node) => node.props['data-event-error-code'] !== undefined)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-data-sync-error-rows': 'true' })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('only exposes error/terminal entries, including retry errors in real log payloads', () => {
    for(const type of ['queued', 'started', 'progress', 'checkpoint', 'succeeded', 'cancelling', 'log'] as const) {
      expect(hasRunEventError(event({ type, payload: { level: 'info' } }))).toBe(false);
    }
    expect(hasRunEventError(event({ type: 'log', payload: { level: 'error' } }))).toBe(true);
    expect(hasRunEventError(event({ type: 'log', payload: { level: 'warn', error: 'retry failed' } }))).toBe(true);
    for(const type of ['failed', 'partial', 'interrupted', 'canceled'] as const) {
      expect(hasRunEventError(event({ type, payload: undefined }))).toBe(true);
    }
  });

  it('never joins rows by table, message, sequence, code, or arbitrary log id', () => {
    expect(resolveRunEventError(event(), rows).rows).toEqual([rows[0]]);
    for(const payload of [{}, { sourceTable: 'orders', errorCode: '23505' }, '{bad json', { id: 'missing' }]) {
      expect(resolveRunEventError(event({ payload }), rows).rows).toEqual([]);
    }
    expect(resolveRunEventError(event({ type: 'log', payload: { id: 'row1', level: 'error' } }), rows).rows).toEqual([]);
    expect(resolveRunEventError(event({ payload: JSON.stringify({ id: 'row1' }) }), rows).rows).toEqual([rows[0]]);
  });

  it('labels terminal rows as run-wide, filters other runs, and supports compare timelines', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<DataSyncRunDetailsModal {...props()} family="compare"
      runEvents={[event({ type: 'failed', payload: undefined })]} />); });
    act(() => renderer.root.findByProps({ 'data-view-event-error': 1 }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain('Run-level error rows');
    expect(renderer.root.findByType('tbody').findAllByType('tr')).toHaveLength(2);
    expect(renderer.root.findAll((node) => node.props['data-event-error-code'] !== undefined)).toHaveLength(0);
    act(() => renderer.unmount());
  });
});
