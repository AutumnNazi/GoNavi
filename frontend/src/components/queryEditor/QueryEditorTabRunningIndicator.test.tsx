import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setCurrentLanguage } from '../../i18n';
import { QueryEditorTabRunningIndicator } from './QueryEditorTabRunningIndicator';
import {
  resetQueryEditorTabExecutionStateForTests,
  setQueryEditorTabExecutionAppearance,
} from './queryEditorTabExecutionState';

describe('QueryEditorTabRunningIndicator', () => {
  beforeEach(() => {
    setCurrentLanguage('zh-CN');
    resetQueryEditorTabExecutionStateForTests();
  });

  afterEach(() => {
    resetQueryEditorTabExecutionStateForTests();
  });

  it('keeps a status dot after SQL finishes instead of hiding the badge', () => {
    expect(JSON.stringify(create(<QueryEditorTabRunningIndicator tabId="query-1" />).toJSON())).toBe('null');

    act(() => {
      setQueryEditorTabExecutionAppearance('query-1', 'running');
    });
    const running = JSON.stringify(create(<QueryEditorTabRunningIndicator tabId="query-1" />).toJSON());
    expect(running).toContain('query-editor-tab-running');
    expect(running).toContain('"data-status":"running"');
    expect(running).toContain('正在执行 SQL');
    expect(running).not.toContain('运行中');

    act(() => {
      setQueryEditorTabExecutionAppearance('query-1', 'done');
    });
    const done = JSON.stringify(create(<QueryEditorTabRunningIndicator tabId="query-1" />).toJSON());
    expect(done).toContain('"data-status":"done"');
    expect(done).toContain('执行完成');

    act(() => {
      setQueryEditorTabExecutionAppearance('query-1', 'error');
    });
    const failed = JSON.stringify(create(<QueryEditorTabRunningIndicator tabId="query-1" />).toJSON());
    expect(failed).toContain('"data-status":"error"');
    expect(failed).toContain('执行失败');

    act(() => {
      setQueryEditorTabExecutionAppearance('query-1', 'read');
    });
    const read = JSON.stringify(create(<QueryEditorTabRunningIndicator tabId="query-1" />).toJSON());
    expect(read).toContain('"data-status":"read"');
    expect(read).toContain('已查看');
  });

  it('renders a dot with an accessible status label and no popping text', () => {
    act(() => {
      setQueryEditorTabExecutionAppearance('query-1', 'running');
    });
    const renderer = create(<QueryEditorTabRunningIndicator tabId="query-1" />);
    const indicator = renderer.root.findByProps({ 'data-testid': 'query-editor-tab-running' });
    expect(indicator.props.role).toBe('status');
    expect(indicator.props['aria-label']).toBe('正在执行 SQL');
    expect(indicator.children).toHaveLength(1);
    const dot = renderer.root.findByProps({ className: 'gn-v2-tab-running-dot' });
    expect(dot.props['aria-hidden']).toBe('true');
    expect(dot.children).toHaveLength(0);
  });
});
