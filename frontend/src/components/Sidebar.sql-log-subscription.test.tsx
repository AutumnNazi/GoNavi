import React, { Profiler, useMemo } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SqlLog, useStore } from '../store';
import {
  selectRecentSidebarSqlLogs,
  selectSidebarCommandSearchSqlLogs,
} from './sidebar/sidebarSqlLogSelector';

const makeLog = (id: string, timestamp: number): SqlLog => ({
  id,
  timestamp,
  sql: `SELECT '${id}'`,
  status: 'success',
  duration: 1,
});

const RecentSqlLogsHarness: React.FC<{
  enabled: boolean;
  onRender: () => void;
}> = ({ enabled, onRender }) => {
  const sqlLogs = useStore((state) => selectSidebarCommandSearchSqlLogs(state, enabled));
  const recentSqlLogs = useMemo(() => selectRecentSidebarSqlLogs(sqlLogs), [sqlLogs]);
  return (
    <Profiler id="recent-sql" onRender={onRender}>
      <output>{recentSqlLogs.map((log) => log.id).join(',')}</output>
    </Profiler>
  );
};

describe('Sidebar SQL log subscription', () => {
  afterEach(() => {
    useStore.setState({ sqlLogs: [] });
    vi.restoreAllMocks();
  });

  it('stays stable while closed and exposes the latest five logs immediately after opening', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useStore.setState({
      sqlLogs: Array.from({ length: 6 }, (_, index) => makeLog(`log-${6 - index}`, 6 - index)),
    });
    let renderCount = 0;
    const onRender = () => { renderCount += 1; };
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<RecentSqlLogsHarness enabled={false} onRender={onRender} />);
    });
    const closedRenderCount = renderCount;

    await act(async () => {
      useStore.getState().addSqlLog(makeLog('log-7', 7));
    });
    expect(renderCount).toBe(closedRenderCount);
    expect(renderer.root.findByType('output').children.join('')).toBe('');

    await act(async () => {
      renderer.update(<RecentSqlLogsHarness enabled onRender={onRender} />);
    });
    expect(renderer.root.findByType('output').children.join('')).toBe('log-7,log-6,log-5,log-4,log-3');
    const openRenderCount = renderCount;

    await act(async () => {
      useStore.getState().addSqlLog(makeLog('log-8', 8));
    });
    expect(renderCount).toBeGreaterThan(openRenderCount);
    expect(renderer.root.findByType('output').children.join('')).toBe('log-8,log-7,log-6,log-5,log-4');

    await act(async () => {
      renderer.unmount();
    });
  });

  it('filters hidden recent queries before applying the five-item limit', () => {
    const logs = Array.from({ length: 7 }, (_, index) => makeLog(`log-${7 - index}`, 7 - index));
    logs[1] = { ...logs[1], hiddenFromRecent: true };

    expect(selectRecentSidebarSqlLogs(logs).map((log) => log.id)).toEqual([
      'log-7',
      'log-5',
      'log-4',
      'log-3',
      'log-2',
    ]);
  });
});
