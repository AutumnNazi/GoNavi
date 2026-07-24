import React from 'react';
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestRendererNode,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setCurrentLanguage } from '../i18n';
import DeferredWorkspaceContentErrorBoundary from './DeferredWorkspaceContentErrorBoundary';
import DeferredWorkspaceContentFallback from './DeferredWorkspaceContentFallback';

vi.mock('antd', () => ({
  Alert: ({
    description,
    message,
    type,
  }: {
    description?: React.ReactNode;
    message?: React.ReactNode;
    type?: string;
  }) => (
    <section role="alert" data-alert-type={type}>
      <strong>{message}</strong>
      {description}
    </section>
  ),
  Button: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => <button type="button" onClick={onClick}>{children}</button>,
  Spin: () => <span data-loading="true" />,
}));

const textContent = (node: ReactTestRendererNode | ReactTestRendererNode[] | null): string => {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((child) => textContent(child)).join('');
  return textContent(node.children);
};

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.error
      ? <div data-root-error="true">root failed</div>
      : this.props.children;
  }
}

afterEach(() => {
  setCurrentLanguage('zh-CN');
  vi.restoreAllMocks();
});

describe('DeferredWorkspaceContentErrorBoundary', () => {
  it('contains a rejected lazy loader locally and retries only the deferred module', async () => {
    setCurrentLanguage('en-US');
    const rootError = vi.fn();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('workspace chunk failed'))
      .mockResolvedValue({ default: () => <div data-workspace-loaded="true">workspace ready</div> });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const healthySiblingUnmounted = vi.fn();

    const HealthySibling: React.FC = () => {
      React.useEffect(() => () => healthySiblingUnmounted(), []);
      return <div data-healthy-sibling="true">healthy state</div>;
    };

    const Harness: React.FC = () => {
      const [nonce, setNonce] = React.useState(0);
      const LazyWorkspace = React.useMemo(() => React.lazy(loader), [nonce]);
      return (
        <DeferredWorkspaceContentErrorBoundary
          key={nonce}
          onRetry={() => setNonce((current) => current + 1)}
        >
          <React.Suspense fallback={<DeferredWorkspaceContentFallback />}>
            <LazyWorkspace />
          </React.Suspense>
        </DeferredWorkspaceContentErrorBoundary>
      );
    };

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <RootErrorBoundary onError={rootError}>
          <HealthySibling />
          <Harness />
        </RootErrorBoundary>,
      );
      await Promise.resolve();
    });

    expect(rootError).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ 'data-root-error': 'true' })).toHaveLength(0);
    expect(renderer.root.findByProps({ role: 'alert' }).props['data-alert-type']).toBe('error');
    expect(textContent(renderer.toJSON())).toContain('Error');
    expect(textContent(renderer.toJSON())).toContain('workspace chunk failed');
    const refreshButton = renderer.root.findByType('button');
    expect(refreshButton.props.children).toBe('Refresh');

    await act(async () => {
      refreshButton.props.onClick();
      await Promise.resolve();
    });

    expect(rootError).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ 'data-workspace-loaded': 'true' })).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-healthy-sibling': 'true' })).toBeTruthy();
    expect(healthySiblingUnmounted).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
