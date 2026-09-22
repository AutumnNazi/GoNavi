/** @vitest-environment jsdom */
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTableDesignerHeight } from './useTableDesignerHeight';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('measures lazy-mounted fields and keeps small independent viewports within their headers', async () => {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} disconnect() {} });
  let available = 180;
  const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.dataset.viewport === 'small' ? available : 600; });
  const offset = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(56);
  function Harness({ active, id }: { active: string; id: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const height = useTableDesignerHeight(ref, active);
    return <>{active === 'columns' && <div ref={ref} data-viewport={id}><div className="ant-table-header" /><output data-result={id}>{height}</output></div>}</>;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<><Harness id="small" active="ddl" /><Harness id="large" active="columns" /></>));
    await act(async () => root.render(<><Harness id="small" active="columns" /><Harness id="large" active="columns" /></>));
    expect(host.querySelector('[data-result="small"]')?.textContent).toBe('124');
    expect(host.querySelector('[data-result="large"]')?.textContent).toBe('544');
    available = 0;
    await act(async () => callbacks.forEach(callback => callback()));
    expect(host.querySelector('[data-result="small"]')?.textContent).toBe('124');
    available = 300;
    await act(async () => callbacks.forEach(callback => callback()));
    expect(host.querySelector('[data-result="small"]')?.textContent).toBe('244');
  } finally { await act(async () => root.unmount()); client.mockRestore(); offset.mockRestore(); vi.unstubAllGlobals(); }
});
