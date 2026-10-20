import { describe, expect, it } from 'vitest';
import type { DataSyncRunEvent } from './model';
import { createDataSyncWorkbenchTranslate } from './text';
import { describeRunEvent, runEventPage, uniqueRunEvents } from './dataSyncRunTimeline';

const event = (patch: Partial<DataSyncRunEvent> = {}): DataSyncRunEvent => ({
  runId: 'run-1', sequence: 1, type: 'progress', message: 'write', stage: 'running',
  table: 'old-table', createdAt: '2026-10-15T00:00:00Z', ...patch,
});
const t = createDataSyncWorkbenchTranslate('en-US');

describe('run timeline presentation', () => {
  it('deduplicates delivery by run and sequence without mutating the input', () => {
    const input = [event({ sequence: 2 }), event(), event(), event({ runId: 'run-2' })];
    expect(uniqueRunEvents(input).map((item) => `${item.runId}:${item.sequence}`))
      .toEqual(['run-1:1', 'run-2:1', 'run-1:2']);
    expect(input).toHaveLength(4);
  });

  it('retains same-text retries, errors, batches, and log/progress pairs', () => {
    const input = [event(), event({ sequence: 2 }), event({ sequence: 3, type: 'log' }),
    event({ sequence: 4, type: 'failed' }), event({ sequence: 5, type: 'failed' }),
    event({ sequence: 6, payload: { current: 2, total: 10 } })];
    expect(uniqueRunEvents(input)).toEqual(input);
  });

  it('uses payload scope and counts instead of stale run-level progress', () => {
    expect(describeRunEvent(event({
      message: 'Writing', payload: {
        stage: 'write', table: 'orders', current: 3, total: 10,
      }
    }), t)).toEqual({ title: 'Writing', type: 'Progress', scope: 'orders', count: '3/10' });
  });

  it('handles JSON payloads, malformed payloads and non-progress payloads safely', () => {
    expect(describeRunEvent(event({ payload: '{"stage":"write","table":"orders","current":0,"total":10}' }), t).count).toBe('0/10');
    expect(describeRunEvent(event({ payload: '{broken' }), t).scope).toBe('Running · old-table');
    expect(describeRunEvent(event({ type: 'log', payload: { stage: 'write', table: 'other', current: 3, total: 10 } }), t).count).toBe('');
  });

  it.each(['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'de-DE', 'ru-RU'])('does not repeat title as body/type in %s', (locale) => {
    const description = describeRunEvent(event({ type: 'started', message: 'started', stage: '' }), createDataSyncWorkbenchTranslate(locale));
    expect(description.title).toBeTruthy();
    expect(description.type).toBe('');
    expect(description.scope).toBe('old-table');
  });

  it('pages after deduplication and clamps empty/shrinking pages', () => {
    const events = uniqueRunEvents(Array.from({ length: 41 }, (_, index) => event({ sequence: index + 1 })));
    expect(runEventPage(events, 2, 20).events.map((item) => item.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
    expect(runEventPage(events, 99, 20)).toMatchObject({ page: 3, pages: 3, total: 41 });
    expect(runEventPage([], 3, 20)).toEqual({ page: 1, pages: 1, total: 0, events: [] });
  });
});
