import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { DataSyncRunHistory } from './DataSyncOperationalViews';
import { DataSyncRunDetailsModal } from './DataSyncRunDetailsModal';
import { RunEventTimeline } from './DataSyncRunEventTimeline';
import type { DataSyncRunHistoryProps } from './dataSyncRunHistoryTypes';
import type { DataSyncRunEvent } from './model';
import { createDataSyncWorkbenchTranslate } from './text';

vi.mock('../common/ResizableDraggableModal', () => ({
  default: ({ children, onCancel }: { children?: React.ReactNode; onCancel: () => void }) =>
    <div role="dialog"><button data-close onClick={onCancel} />{children}</div>,
}));
const events = (runId = 'run-1', count = 41): DataSyncRunEvent[] => Array.from({ length: count }, (_, index) => ({
  runId, sequence: index + 1, type: 'log', message: `message-${index + 1}`, createdAt: '',
}));
const props = (): DataSyncRunHistoryProps => ({
  runs: [], runPage: 1, runPageSize: 10, runTotal: 0, hasPreviousRunPage: false, hasNextRunPage: false,
  selectedRunId: 'run-1', runEvents: events(), errorRows: [], compareResult: null, checkpoint: null,
  busyAction: '', t: createDataSyncWorkbenchTranslate('en-US'), onSelectRun: vi.fn(), onRefresh: vi.fn(),
  onPreviousRunPage: vi.fn(), onNextRunPage: vi.fn(), onRunPageSizeChange: vi.fn(), onDeleteRun: vi.fn(),
  onClearTerminalRuns: vi.fn(), onCancel: vi.fn(), onResume: vi.fn(), onRetry: vi.fn(),
  onDiscardErrorRow: vi.fn(), errorRowRetryAvailable: false, onRetryErrorRow: vi.fn(),
  checkpointResetEnabled: false, onResetCheckpoint: vi.fn(),
});
const sequences = (renderer: TestRenderer.ReactTestRenderer) => renderer.root
  .findAll((node) => node.type === 'li' && node.props['data-event-sequence'] !== undefined)
  .map((node) => node.props['data-event-sequence']);
const next = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType('button')
  .find((node) => node.children.includes('Next page'))!;

describe('run detail modal and timeline', () => {
  it('renders details only inside the dialog and clears selection on cancel', () => {
    const input = props();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<DataSyncRunHistory {...input} />); });
    const dialog = renderer.root.findByProps({ role: 'dialog' });
    expect(dialog.findByProps({ 'data-data-sync-run-events': 'true' })).toBeTruthy();
    act(() => { renderer.root.findByProps({ 'data-close': true }).props.onClick(); });
    expect(input.onSelectRun).toHaveBeenCalledWith('');
    act(() => { renderer.update(<DataSyncRunHistory {...input} selectedRunId="" />); });
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ 'data-data-sync-run-events': 'true' })).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('pages events, preserves the page on refresh, resets size/run and reopens at page one', () => {
    const input = props();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<DataSyncRunDetailsModal {...input} />); });
    expect(sequences(renderer)).toHaveLength(20);
    act(() => next(renderer).props.onClick());
    expect(sequences(renderer)[0]).toBe(21);
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} runEvents={events('run-1', 42)} />));
    expect(sequences(renderer)[0]).toBe(21);
    act(() => renderer.root.findByType('select').props.onChange({ target: { value: '50' } }));
    expect(sequences(renderer)).toHaveLength(42);
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} selectedRunId="run-2" runEvents={events('run-2')} />));
    expect(sequences(renderer)).toHaveLength(20);
    expect(sequences(renderer)[0]).toBe(1);
    act(() => next(renderer).props.onClick());
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} selectedRunId="" />));
    act(() => renderer.update(<DataSyncRunDetailsModal {...input} />));
    expect(sequences(renderer)[0]).toBe(1);
    act(() => renderer.unmount());
  });

  it('does not display a stale event from another run', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<DataSyncRunDetailsModal {...props()} selectedRunId="run-2" />); });
    expect(sequences(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('bounds rendered events and does not append duplicate polling snapshots', () => {
    const input = events('run-1', 501);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<RunEventTimeline events={input} t={props().t} />); });
    act(() => renderer.update(<RunEventTimeline events={[...input, ...input]} t={props().t} />));
    expect(sequences(renderer)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    act(() => renderer.unmount());
  });
});
