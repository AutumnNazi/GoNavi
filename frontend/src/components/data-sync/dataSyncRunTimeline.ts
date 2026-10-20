import type { DataSyncRunEvent } from './model';
import type { DataSyncWorkbenchTranslate } from './text';
import { formatDataSyncRunEvent } from './textSchedules';

// Identity, not text, determines duplicate delivery. Different sequences may
// represent retries, batches, or separate log/progress evidence and must survive.
export function uniqueRunEvents(events: readonly DataSyncRunEvent[]): DataSyncRunEvent[] {
  const unique = new Map<string, DataSyncRunEvent>();
  for(const event of events) unique.set(`${event.runId}:${event.sequence}`, event);
  return [...unique.values()].sort((a, b) => a.sequence - b.sequence);
}

function eventPayload(value: unknown): Record<string, unknown> {
  if(typeof value === 'string') {
    try { return eventPayload(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function describeRunEvent(event: DataSyncRunEvent, t: DataSyncWorkbenchTranslate) {
  const payload = eventPayload(event.payload);
  const progress = event.type === 'progress';
  const stage = progress && typeof payload.stage === 'string' ? payload.stage : event.stage;
  const table = progress && typeof payload.table === 'string' ? payload.table : event.table;
  const translated = formatDataSyncRunEvent({ ...event, stage, table }, t);
  // Put the actual event message first instead of repeating generic headings.
  const title = (event.message === stage ? translated.stage : translated.message)
    || translated.stage || translated.type;
  const scope = [translated.stage !== title ? translated.stage : '', table].filter(Boolean).join(' · ');
  const current = payload.current;
  const total = payload.total;
  const count = progress && typeof current === 'number' && Number.isFinite(current)
    && typeof total === 'number' && Number.isFinite(total) ? `${current}/${total}` : '';
  return { title, type: translated.type !== title ? translated.type : '', scope, count };
}

export function runEventPage(events: readonly DataSyncRunEvent[], page: number, pageSize: number) {
  const total = events.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  return { events: events.slice((current - 1) * pageSize, current * pageSize), page: current, pages, total };
}
