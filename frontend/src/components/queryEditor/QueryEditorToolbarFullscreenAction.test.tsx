import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setCurrentLanguage } from '../../i18n';
import { QueryEditorToolbarFullscreenAction } from './QueryEditorToolbarFullscreenAction';

const antdState = vi.hoisted(() => ({
  buttonProps: [] as any[],
  tooltipTitles: [] as any[],
}));

vi.mock('antd', () => ({
  Button: (props: any) => {
    antdState.buttonProps.push(props);
    return (
      <button
        type="button"
        aria-label={props['aria-label']}
        aria-pressed={props['aria-pressed']}
        onClick={props.onClick}
      />
    );
  },
  Tooltip: ({ title, children }: any) => {
    antdState.tooltipTitles.push(title);
    return <>{children}</>;
  },
}));

vi.mock('@ant-design/icons', () => {
  const Icon = ({ type }: { type?: string }) => <span data-icon={type} />;
  return {
    FullscreenOutlined: () => <span data-icon="fullscreen" />,
    FullscreenExitOutlined: () => <span data-icon="fullscreen-exit" />,
  };
});

const buildProps = (overrides: Record<string, unknown> = {}) => ({
  active: false,
  shortcutBinding: { combo: 'F11', enabled: true },
  activeShortcutPlatform: 'windows' as const,
  onToggle: vi.fn(),
  ...overrides,
});

describe('QueryEditorToolbarFullscreenAction', () => {
  beforeEach(() => {
    antdState.buttonProps = [];
    antdState.tooltipTitles = [];
    setCurrentLanguage('zh-CN');
  });

  it('shows the enter action while inactive', () => {
    const onToggle = vi.fn();
    act(() => { create(<QueryEditorToolbarFullscreenAction {...buildProps({ onToggle })} />); });
    expect(antdState.buttonProps).toHaveLength(1);
    expect(antdState.buttonProps[0]).toMatchObject({
      'aria-label': '编辑器全屏',
      'aria-pressed': false,
      type: 'default',
      className: expect.stringContaining('gn-v2-query-toolbar-fullscreen-action'),
    });
    expect(antdState.tooltipTitles[0]).toBe('编辑器全屏（F11）');
    act(() => { antdState.buttonProps[0].onClick(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the exit action and pressed state while fullscreen', () => {
    act(() => {
      create(<QueryEditorToolbarFullscreenAction {...buildProps({
        active: true,
        shortcutBinding: { combo: 'Ctrl+F11', enabled: true },
        activeShortcutPlatform: 'mac',
      })} />);
    });
    expect(antdState.buttonProps[0]).toMatchObject({
      'aria-label': '退出编辑器全屏',
      'aria-pressed': true,
      type: 'primary',
    });
    expect(antdState.tooltipTitles[0]).toBe('退出编辑器全屏（⌃F11）');
  });

  it('falls back to the plain title when the shortcut is disabled', () => {
    act(() => {
      create(<QueryEditorToolbarFullscreenAction {...buildProps({
        shortcutBinding: { combo: '', enabled: false },
      })} />);
    });
    expect(antdState.tooltipTitles[0]).toBe('编辑器全屏');
  });
});
