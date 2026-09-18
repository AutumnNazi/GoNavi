import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryEditorToolbarRunAction } from './QueryEditorToolbarRunAction';

const antdState = vi.hoisted(() => ({
  buttonProps: [] as any[],
}));

vi.mock('antd', () => ({
  Button: (props: any) => {
    antdState.buttonProps.push(props);
    return (
      <button
        type="button"
        aria-label={props['aria-label']}
        disabled={props.disabled || props.loading}
        onClick={props.onClick}
      />
    );
  },
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('@ant-design/icons', () => {
  const Icon = () => <span />;
  return {
    LoadingOutlined: Icon,
    PlayCircleOutlined: Icon,
  };
});

const buildProps = (overrides: Record<string, unknown> = {}) => ({
  title: 'Run · Ctrl+Enter',
  ariaLabel: 'Run',
  stopTitle: 'Stop',
  loading: false,
  disabled: false,
  onCaptureEditorCursorPosition: vi.fn(),
  onRun: vi.fn(),
  onCancel: vi.fn(),
  ...overrides,
});

describe('QueryEditorToolbarRunAction', () => {
  beforeEach(() => {
    antdState.buttonProps = [];
  });

  it('runs from the idle play control', () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    const onCaptureEditorCursorPosition = vi.fn();

    act(() => {
      create(<QueryEditorToolbarRunAction {...buildProps({
        onRun,
        onCancel,
        onCaptureEditorCursorPosition,
      })} />);
    });

    expect(antdState.buttonProps).toHaveLength(1);
    expect(antdState.buttonProps[0]).toMatchObject({
      'aria-label': 'Run',
      className: expect.stringContaining('gn-v2-query-toolbar-run-action'),
      disabled: false,
    });
    expect(antdState.buttonProps[0].loading).toBeUndefined();
    expect(antdState.buttonProps[0]['aria-busy']).toBeUndefined();

    act(() => {
      antdState.buttonProps[0].onMouseDown();
      antdState.buttonProps[0].onClick();
    });
    expect(onCaptureEditorCursorPosition).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the spinning run button clickable so it can stop without a second control', () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    const onCaptureEditorCursorPosition = vi.fn();

    act(() => {
      create(<QueryEditorToolbarRunAction {...buildProps({
        loading: true,
        disabled: true,
        onRun,
        onCancel,
        onCaptureEditorCursorPosition,
      })} />);
    });

    expect(antdState.buttonProps).toHaveLength(1);
    expect(antdState.buttonProps[0]).toMatchObject({
      'aria-label': 'Stop',
      'aria-busy': true,
      className: expect.stringContaining('gn-v2-query-toolbar-run-action'),
      disabled: false,
    });
    expect(antdState.buttonProps[0].loading).toBeUndefined();
    expect(antdState.buttonProps[0].onMouseDown).toBeUndefined();

    act(() => {
      antdState.buttonProps[0].onClick();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
    expect(onCaptureEditorCursorPosition).not.toHaveBeenCalled();
  });

  it('disables the idle run control when the editor cannot execute', () => {
    act(() => {
      create(<QueryEditorToolbarRunAction {...buildProps({ disabled: true })} />);
    });

    expect(antdState.buttonProps[0].disabled).toBe(true);
  });
});
