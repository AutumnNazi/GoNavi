/** @vitest-environment jsdom */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOverlayWorkbenchTheme } from '../../../utils/overlayWorkbenchTheme';
import { AIMessageCodeBlock } from './AIMessageCodeBlock';

vi.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  message: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../common/ResizableDraggableModal', () => ({
  default: Object.assign(() => null, { confirm: vi.fn() }),
}));

vi.mock('@ant-design/icons', () => ({
  CheckOutlined: () => null,
  CopyOutlined: () => null,
  PlayCircleOutlined: () => null,
  SwapOutlined: () => null,
}));

vi.mock('react-syntax-highlighter', () => ({ default: () => null }));

vi.mock('react-syntax-highlighter/dist/esm/prism-light', () => ({
  default: Object.assign(() => null, { registerLanguage: vi.fn() }),
}));

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg/>' })) },
}));

const INSERT_EVENT = 'gonavi:insert-sql';

const renderSqlBlock = (originalSqlCandidates?: string[]): ReactTestRenderer => {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(AIMessageCodeBlock, {
      className: 'language-sql',
      darkMode: false,
      overlayTheme: buildOverlayWorkbenchTheme(false),
      originalSqlCandidates,
      children: 'SELECT fixed;',
    }));
  });
  return renderer as unknown as ReactTestRenderer;
};

const clickActionButton = (renderer: ReactTestRenderer, index: number): void => {
  const buttons = renderer.root.findAll((node) => node.props.className === 'ai-code-run-btn');
  const button = buttons[index];
  expect(button).toBeDefined();
  act(() => {
    (button as unknown as { props: { onClick: () => void } }).props.onClick();
  });
};

describe('AIMessageCodeBlock insert and replace buttons', () => {
  let captured: Array<Record<string, unknown>>;
  let listener: ((event: Event) => void) | null = null;

  beforeEach(() => {
    captured = [];
    listener = (event: Event) => {
      captured.push((event as CustomEvent).detail);
    };
    window.addEventListener(INSERT_EVENT, listener as EventListener);
  });

  afterEach(() => {
    if (listener) {
      window.removeEventListener(INSERT_EVENT, listener as EventListener);
    }
  });

  it('keeps the plain insert detail on the insert button', () => {
    const renderer = renderSqlBlock(['SELECT broken;']);
    clickActionButton(renderer, 0);
    act(() => renderer.unmount());

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ sql: 'SELECT fixed;', runImmediately: false });
    expect(captured[0].replaceOriginal).toBeUndefined();
    expect(captured[0].originalSqlCandidates).toBeUndefined();
  });

  it('emits replace fields from the dedicated replace button', () => {
    const renderer = renderSqlBlock(['SELECT broken;']);
    clickActionButton(renderer, 1);
    act(() => renderer.unmount());

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      sql: 'SELECT fixed;',
      runImmediately: false,
      replaceOriginal: true,
      originalSqlCandidates: ['SELECT broken;'],
    });
  });

  it('renders only the insert button when no candidates exist', () => {
    const renderer = renderSqlBlock(undefined);
    const buttons = renderer.root.findAll((node) => node.props.className === 'ai-code-run-btn');
    expect(buttons).toHaveLength(2);
    clickActionButton(renderer, 0);
    act(() => renderer.unmount());

    expect(captured).toHaveLength(1);
    expect(captured[0].replaceOriginal).toBeUndefined();
  });
});
