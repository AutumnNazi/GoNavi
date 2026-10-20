// @vitest-environment jsdom
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreviewSurface } from './PreviewSurface';
import * as styleScope from './previewStyleScope';

class VisibilityObserver implements IntersectionObserver {
  static instances: VisibilityObserver[] = [];
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  target: Element | null = null;
  disconnect = vi.fn();
  constructor(private callback: IntersectionObserverCallback) { VisibilityObserver.instances.push(this); }
  observe(target: Element) { this.target = target; }
  unobserve() {}
  takeRecords() { return []; }
  report(isIntersecting: boolean) {
    this.callback([{ target: this.target!, isIntersecting } as IntersectionObserverEntry], this);
  }
}
let container: HTMLDivElement;
let root: Root;
const mounts = vi.fn();
function StatefulPreview() {
  const [count, setCount] = useState(0);
  useEffect(() => { mounts(); }, []);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', VisibilityObserver);
  VisibilityObserver.instances = [];
  mounts.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('defers offscreen workbenches and style copying until visible, then preserves local state', async () => {
  const collect = vi.spyOn(styleScope, 'collectPreviewStyles');
  await act(async () => root.render(<>{[0, 1, 2, 3].map(index =>
    <PreviewSurface key={index} mode="classic" label={'Preview ' + index}><StatefulPreview /></PreviewSurface>,
  )}</>));
  expect(mounts.mock.calls.length).toBe(0);
  expect(collect.mock.calls.length).toBe(0);
  const hosts = container.querySelectorAll<HTMLElement>('.gn-live-preview-host');
  expect(hosts).toHaveLength(4);
  expect(hosts[0].style.height).toBe('640px');
  await act(async () => VisibilityObserver.instances[0].report(true));
  expect(mounts).toHaveBeenCalledTimes(1);
  expect(collect).toHaveBeenCalledTimes(1);
  expect(VisibilityObserver.instances[0].disconnect).toHaveBeenCalled();
  const button = hosts[0].shadowRoot!.querySelector('button')!;
  await act(async () => button.click());
  await act(async () => VisibilityObserver.instances[0].report(false));
  expect(hosts[0].shadowRoot!.querySelector('button')!.textContent).toBe('1');
  expect(mounts).toHaveBeenCalledTimes(1);
  await act(async () => VisibilityObserver.instances[1].report(true));
  expect(mounts).toHaveBeenCalledTimes(2);
  expect(collect).toHaveBeenCalledTimes(1);
});

it('disconnects visibility observation when navigating away before a preview enters view', async () => {
  await act(async () => root.render(<PreviewSurface mode="classic" label="Preview"><StatefulPreview /></PreviewSurface>));
  expect(mounts.mock.calls.length).toBe(0);
  await act(async () => root.render(<div>Other settings</div>));
  expect(VisibilityObserver.instances[0].disconnect).toHaveBeenCalledOnce();
  expect(mounts.mock.calls.length).toBe(0);
});
