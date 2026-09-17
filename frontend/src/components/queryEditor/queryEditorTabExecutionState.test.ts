/** @vitest-environment jsdom */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acknowledgeQueryEditorTabExecution,
  getQueryEditorTabExecutionAppearance,
  isQueryEditorTabExecuting,
  pruneQueryEditorTabExecutionState,
  resetQueryEditorTabExecutionStateForTests,
  resolveQueryEditorTabExecutionAppearance,
  setQueryEditorTabExecutionAppearance,
  setQueryEditorTabExecuting,
  useQueryEditorTabExecutionAppearance,
  useQueryEditorTabExecutionBroadcast,
} from './queryEditorTabExecutionState';

let latestAppearance = 'idle';

const Harness = ({
  tabId,
  executing,
  lifecycleStatus = 'idle',
  isActive = false,
}: {
  tabId: string;
  executing: boolean;
  lifecycleStatus?: string;
  isActive?: boolean;
}) => {
  useQueryEditorTabExecutionBroadcast(tabId, executing, lifecycleStatus, isActive);
  latestAppearance = useQueryEditorTabExecutionAppearance(tabId);
  return null;
};

describe('query editor tab execution state', () => {
  afterEach(() => {
    resetQueryEditorTabExecutionStateForTests();
  });

  it('maps loading and lifecycle onto running, done, error, and read dots', () => {
    expect(resolveQueryEditorTabExecutionAppearance(true, 'idle', 'idle')).toBe('running');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'running', 'idle')).toBe('idle');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'done', 'running')).toBe('done');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'done', 'read')).toBe('read');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'error', 'running')).toBe('error');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'error', 'read')).toBe('read');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'cancelled', 'running')).toBe('idle');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'idle', 'done')).toBe('done');
    expect(resolveQueryEditorTabExecutionAppearance(false, 'idle', 'running')).toBe('idle');
  });

  it('tracks executing SQL tabs and clears only the in-flight state', () => {
    setQueryEditorTabExecuting('query-1', true);
    expect(isQueryEditorTabExecuting('query-1')).toBe(true);
    expect(isQueryEditorTabExecuting('query-2')).toBe(false);

    setQueryEditorTabExecuting('query-1', false);
    expect(isQueryEditorTabExecuting('query-1')).toBe(false);
  });

  it('drops closed tabs from the map and keeps open ones', () => {
    setQueryEditorTabExecutionAppearance('done-1', 'done');
    setQueryEditorTabExecutionAppearance('run-1', 'running');
    pruneQueryEditorTabExecutionState(['run-1']);
    expect(getQueryEditorTabExecutionAppearance('done-1')).toBe('idle');
    expect(getQueryEditorTabExecutionAppearance('run-1')).toBe('running');
  });

  it('broadcasts a live run and keeps the status when the tab is hidden', () => {
    let renderer: ReactTestRenderer | null = null;
    latestAppearance = 'idle';
    act(() => {
      renderer = create(React.createElement(Harness, {
        tabId: 'query-live',
        executing: true,
        lifecycleStatus: 'running',
        isActive: true,
      }));
    });
    expect(latestAppearance).toBe('running');
    expect(isQueryEditorTabExecuting('query-live')).toBe(true);

    act(() => {
      renderer?.update(React.createElement(Harness, {
        tabId: 'query-live',
        executing: false,
        lifecycleStatus: 'done',
        isActive: false,
      }));
    });
    expect(getQueryEditorTabExecutionAppearance('query-live')).toBe('done');
    expect(isQueryEditorTabExecuting('query-live')).toBe(false);
  });

  it('keeps finished dots after a hidden editor unmounts, and only forgets running work', () => {
    let renderer: ReactTestRenderer | null = null;
    act(() => {
      renderer = create(React.createElement(Harness, {
        tabId: 'query-hidden',
        executing: false,
        lifecycleStatus: 'done',
      }));
    });
    expect(getQueryEditorTabExecutionAppearance('query-hidden')).toBe('done');
    act(() => {
      renderer?.unmount();
    });
    expect(getQueryEditorTabExecutionAppearance('query-hidden')).toBe('done');

    act(() => {
      renderer = create(React.createElement(Harness, {
        tabId: 'query-running-close',
        executing: true,
        lifecycleStatus: 'running',
      }));
    });
    act(() => {
      renderer?.unmount();
    });
    expect(getQueryEditorTabExecutionAppearance('query-running-close')).toBe('idle');

    acknowledgeQueryEditorTabExecution('query-hidden');
    expect(getQueryEditorTabExecutionAppearance('query-hidden')).toBe('read');
  });

  it('marks a finished SQL tab as read when it is the active tab', () => {
    let renderer: ReactTestRenderer | null = null;
    act(() => {
      renderer = create(React.createElement(Harness, {
        tabId: 'query-active',
        executing: true,
        lifecycleStatus: 'running',
        isActive: true,
      }));
    });
    act(() => {
      renderer?.update(React.createElement(Harness, {
        tabId: 'query-active',
        executing: false,
        lifecycleStatus: 'done',
        isActive: true,
      }));
    });
    expect(getQueryEditorTabExecutionAppearance('query-active')).toBe('read');
  });
});
