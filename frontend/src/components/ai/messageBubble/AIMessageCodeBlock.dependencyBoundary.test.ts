// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildOverlayWorkbenchTheme } from '../../../utils/overlayWorkbenchTheme';
import { AIMessageCodeBlock } from './AIMessageCodeBlock';
import { MERMAID_MAX_SOURCE_LENGTH } from './mermaidSecurity';

const dependencyMocks = vi.hoisted(() => ({
  completeRegistryLoad: vi.fn(),
  mermaidInitialize: vi.fn(),
  mermaidLoad: vi.fn(),
  mermaidRender: vi.fn<(id: string, chart: string) => Promise<{ svg: string }>>(
    async () => ({ svg: '<svg>diagram</svg>' }),
  ),
  prismLightLoad: vi.fn(),
  registerLanguage: vi.fn(),
}));

vi.mock('react-syntax-highlighter', () => {
  dependencyMocks.completeRegistryLoad();
  return { default: () => null };
});

vi.mock('react-syntax-highlighter/dist/esm/prism-light', () => {
  dependencyMocks.prismLightLoad();
  return {
    default: Object.assign(() => null, {
      registerLanguage: dependencyMocks.registerLanguage,
    }),
  };
});

vi.mock('mermaid', () => {
  dependencyMocks.mermaidLoad();
  return {
    default: {
      initialize: dependencyMocks.mermaidInitialize,
      render: dependencyMocks.mermaidRender,
    },
  };
});

vi.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  message: { error: vi.fn() },
}));

vi.mock('@ant-design/icons', () => ({
  CheckOutlined: () => null,
  CopyOutlined: () => null,
  PlayCircleOutlined: () => null,
}));

vi.mock('../../common/ResizableDraggableModal', () => ({
  default: Object.assign(() => null, { confirm: vi.fn() }),
}));

const renderCodeBlock = (className: string, children: string) => React.createElement(AIMessageCodeBlock, {
  className,
  children,
  darkMode: false,
  overlayTheme: buildOverlayWorkbenchTheme(false),
});

describe('AIMessageCodeBlock dependency boundary', () => {
  afterEach(() => {
    dependencyMocks.mermaidRender.mockImplementation(async () => ({ svg: '<svg>diagram</svg>' }));
    vi.useRealTimers();
  });

  it('loads the lightweight syntax highlighter without the complete language registry', () => {
    expect(dependencyMocks.completeRegistryLoad).not.toHaveBeenCalled();
    expect(dependencyMocks.prismLightLoad).toHaveBeenCalledOnce();
    expect(dependencyMocks.registerLanguage).toHaveBeenCalledTimes(20);
  });

  it('loads Mermaid only when a Mermaid fenced block is rendered', async () => {
    let renderer: ReactTestRenderer | undefined;

    try {
      act(() => {
        renderer = create(renderCodeBlock('language-sql', 'SELECT 1;'));
      });
      expect(dependencyMocks.mermaidLoad).not.toHaveBeenCalled();

      await act(async () => {
        renderer?.update(renderCodeBlock('language-mermaid', 'graph TD; A-->B;'));
      });
      await vi.waitFor(() => {
        expect(dependencyMocks.mermaidLoad).toHaveBeenCalledOnce();
        expect(dependencyMocks.mermaidInitialize).toHaveBeenCalledWith(expect.objectContaining({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          maxTextSize: MERMAID_MAX_SOURCE_LENGTH,
          maxEdges: 500,
        }));
        expect(dependencyMocks.mermaidRender).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD; A-->B;');
        const sandbox = renderer?.root.findByProps({ 'data-testid': 'ai-mermaid-sandbox' });
        expect(sandbox?.props.sandbox).toBe('');
        expect(sandbox?.props.srcDoc).toContain('<svg>diagram</svg>');
      });
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('rejects oversized Mermaid input before invoking the renderer', async () => {
    const renderCount = dependencyMocks.mermaidRender.mock.calls.length;
    let renderer: ReactTestRenderer | undefined;

    try {
      await act(async () => {
        renderer = create(renderCodeBlock(
          'language-mermaid',
          'x'.repeat(MERMAID_MAX_SOURCE_LENGTH + 1),
        ));
      });
      await vi.waitFor(() => {
        expect(dependencyMocks.mermaidRender).toHaveBeenCalledTimes(renderCount);
        const container = renderer?.root.findByProps({ className: 'ai-mermaid-container' });
        expect(container?.children.join('')).toContain('source exceeds');
      });
    } finally {
      act(() => renderer?.unmount());
    }
  });

  it('isolates a timed-out Mermaid chart and recovers on the next chart', async () => {
    dependencyMocks.mermaidRender.mockImplementation(async (_id: string, chart: string) => {
      if (chart.includes('slow')) throw new Error('mermaid render timeout');
      return { svg: '<svg><text>fast diagram</text></svg>' };
    });
    let renderer: ReactTestRenderer | undefined;

    try {
      await act(async () => {
        renderer = create(renderCodeBlock('language-mermaid', 'graph TD; slow-->wait;'));
        await vi.dynamicImportSettled();
      });

      await vi.waitFor(() => {
        const containers = renderer?.root.findAllByProps({ className: 'ai-mermaid-container' }) || [];
        expect(containers.some((container) => container.children.join('').includes('timeout'))).toBe(true);
      });

      await act(async () => {
        renderer?.update(renderCodeBlock('language-mermaid', 'graph TD; fast-->done;'));
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(dependencyMocks.mermaidRender.mock.calls.map(([, chart]) => chart)).toContain(
          'graph TD; fast-->done;',
        );
        const sandboxes = renderer?.root.findAllByProps({ 'data-testid': 'ai-mermaid-sandbox' }) || [];
        expect(sandboxes).toHaveLength(1);
        expect(sandboxes[0].props.srcDoc).toContain('fast diagram');
      });
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
