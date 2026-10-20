import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { AIWorkspaceSnapshotPublisher } from './AIWorkspaceSnapshotPublisher';
import { setQueryTabDraft, clearQueryTabDraft } from '../../utils/sqlFileTabDrafts';
import { publishAIWorkspaceSnapshotNow, useAIWorkspaceSnapshot } from './useAIWorkspaceSnapshot';
import type { WorkspaceSnapshotRequest } from './aiRunHarnessClient';

const initial = useStore.getState();
let view: ReactTestRenderer | undefined;
const publish = vi.fn<(snapshot: WorkspaceSnapshotRequest) => Promise<{ accepted: boolean }>>();
const readSql = vi.fn(() => 'select 1;'.repeat(10000));
function Harness({ enabled = true }: { enabled?: boolean }) {
  useAIWorkspaceSnapshot({ enabled });
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  publish.mockReset().mockResolvedValue({ accepted: true });
  readSql.mockClear();
  vi.stubGlobal('window', { go: { aiservice: { Service: { AIUpdateWorkspaceSnapshot: publish } } } });
  useStore.setState({ activeContext: null, tabs: [], activeTabId: null, sqlLogs: [], sqlSnippets: [],
    savedQueries: [{ id: 'saved', name: 'Saved', connectionId: '', dbName: '', createdAt: 1, get sql() { return readSql(); } }],
  });
});
afterEach(async () => {
  await act(async () => view?.unmount()); view = undefined;
  clearQueryTabDraft('live-query');
  useStore.setState(initial, true);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it.each([true, false])('does not stringify the full store input when enabled=%s', async enabled => {
  const stringify = vi.spyOn(JSON, 'stringify');
  await act(async () => { view = create(<Harness enabled={enabled} />); });
  await act(async () => { useStore.setState({ activeTabId: 'next' }); });
  const fullInputCalls = stringify.mock.calls.filter(([value]) => value && typeof value === 'object'
    && 'savedQueries' in value && 'sqlSnippets' in value && 'activeTabId' in value);
  expect(fullInputCalls).toHaveLength(0);
});

it('reuses unchanged collection projections while still publishing active-context changes', async () => {
  await act(async () => { view = create(<Harness />); });
  const first = publish.mock.calls[0][0];
  readSql.mockClear();
  await act(async () => { useStore.setState({ activeTabId: 'second' }); });
  const second = publish.mock.lastCall![0];
  expect(second.activeTabId).toBe('second');
  expect(second.revision).toBeGreaterThan(first.revision);
  expect(second.savedQueries).toBe(first.savedQueries);
  expect(readSql).not.toHaveBeenCalled();
  await act(async () => { await publishAIWorkspaceSnapshotNow(); });
  expect(publish.mock.lastCall![0].savedQueries).toBe(first.savedQueries);
  expect(readSql).not.toHaveBeenCalled();
});

it('invalidates a changed collection without rebuilding other collections or old revisions', async () => {
  await act(async () => { view = create(<Harness />); });
  const first = publish.mock.calls[0][0];
  await act(async () => { useStore.setState({ savedQueries: [{ id: 'replacement', name: 'New', connectionId: '', dbName: '', createdAt: 2, sql: 'select 2;' }] }); });
  const next = publish.mock.lastCall![0];
  expect(next.savedQueries).toEqual([{ id: 'replacement', name: 'New', content: 'select 2;' }]);
  expect(next.snippets).toBe(first.snippets);
  expect(first.savedQueries).toEqual([expect.objectContaining({ id: 'saved' })]);
});

it('keeps live drafts fresh when publishing without a store change', async () => {
  useStore.setState({ tabs: [{ id: 'live-query', title: 'Live', type: 'query', connectionId: '', dbName: '', query: 'select 1;' }], activeTabId: 'live-query' });
  await act(async () => { view = create(<Harness />); });
  setQueryTabDraft('live-query', 'select 2;');
  await act(async () => { await publishAIWorkspaceSnapshotNow(); });
  expect(publish.mock.lastCall![0].tabs).toEqual([expect.objectContaining({ draft: 'select 2;' })]);
});

it('does not render the shell owner when the publisher receives a tab update', async () => {
  const renderOwner = vi.fn();
  function Owner() { renderOwner(); return <AIWorkspaceSnapshotPublisher />; }
  await act(async () => { view = create(<Owner />); });
  await act(async () => { useStore.setState({ activeTabId: 'other' }); });
  expect(renderOwner).toHaveBeenCalledOnce();
  expect(publish.mock.lastCall![0].activeTabId).toBe('other');
});
