/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkbenchTabActivation } from './useWorkbenchTabActivation';

const storeHarness = vi.hoisted(() => ({ useStore: null as any }));

vi.mock('../store', async () => {
  const { create } = await import('zustand');
  storeHarness.useStore = create<{ activeTabId: string }>(() => ({ activeTabId: 'tab-a' }));
  return { useStore: storeHarness.useStore };
});

const seen: Array<{ id: string; active: boolean }> = [];

const Probe = ({ id, explicit }: { id: string; explicit?: boolean }) => {
  const active = useWorkbenchTabActivation(id, explicit);
  seen.push({ id, active });
  return <span data-active={active ? '1' : '0'} />;
};

describe('useWorkbenchTabActivation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    seen.length = 0;
    storeHarness.useStore.setState({ activeTabId: 'tab-a' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it('follows the store active tab and settles after the deferred pass', async () => {
    await act(async () => {
      root.render(<><Probe id="tab-a" /><Probe id="tab-b" /></>);
    });
    expect(container.innerHTML).toBe('<span data-active="1"></span><span data-active="0"></span>');

    await act(async () => {
      storeHarness.useStore.setState({ activeTabId: 'tab-b' });
    });
    expect(container.innerHTML).toBe('<span data-active="0"></span><span data-active="1"></span>');
  });

  it('renders the previous activation first so the switch paints before heavy content updates', async () => {
    await act(async () => {
      root.render(<Probe id="tab-b" />);
    });
    seen.length = 0;
    await act(async () => {
      storeHarness.useStore.setState({ activeTabId: 'tab-b' });
    });
    // First (urgent) render keeps the stale deferred value; the transition render flips it.
    expect(seen.map((entry) => entry.active)).toEqual([false, true]);
  });

  it('keeps an explicit activation immediate for detached windows', async () => {
    await act(async () => {
      root.render(<Probe id="tab-x" explicit />);
    });
    expect(container.innerHTML).toBe('<span data-active="1"></span>');
    await act(async () => {
      root.render(<Probe id="tab-x" explicit={false} />);
    });
    expect(container.innerHTML).toBe('<span data-active="0"></span>');
  });
});
