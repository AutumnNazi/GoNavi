/** @vitest-environment jsdom */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ PluginList: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);

import type { PluginNavigation, PluginPage, PluginStatus } from '../plugins/types';
import { usePluginPageTarget, type PluginPageTarget } from './usePluginPageTarget';

const status = (
  over: Partial<PluginStatus> = {},
  pages: PluginPage[] = [{ id: 'overview', title: 'Overview', body: { type: 'text', text: 'hi' } }],
  navigation: PluginNavigation[] = [{ id: 'overview-tools', title: 'Overview', page: 'overview', location: 'tools' }],
): PluginStatus => ({
  manifest: {
    schemaVersion: 1,
    apiVersion: 1,
    id: 'test.pages',
    name: 'Pages',
    version: '1.0.0',
    permissions: ['ui.pages'],
    contributes: { pages, navigation },
  },
  digest: 'a'.repeat(64),
  state: 'running',
  desiredEnabled: true,
  generation: 1,
  installedAt: '2026-01-01',
  ...over,
});

const captured: { value?: PluginPageTarget } = {};
const Harness = ({ pluginID, pageID }: { pluginID: string; pageID: string }) => {
  captured.value = usePluginPageTarget(pluginID, pageID);
  return null;
};
let renderer: ReactTestRenderer | undefined;

const render = async (pluginID = 'test.pages', pageID = 'overview') => {
  await act(async () => {
    renderer = create(<Harness pluginID={pluginID} pageID={pageID} />);
    await vi.advanceTimersByTimeAsync(0);
  });
  return captured.value!;
};

const unmount = () => {
  act(() => renderer?.unmount());
  renderer = undefined;
};

beforeEach(() => {
  vi.useFakeTimers();
  captured.value = undefined;
  host.PluginList.mockReset();
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('usePluginPageTarget', () => {
  it('resolves a declared page of a running plugin', async () => {
    host.PluginList.mockResolvedValue({ success: true, data: [status()] });
    const target = await render();
    expect(target.loading).toBe(false);
    expect(target.available).toBe(true);
    expect(target.page?.id).toBe('overview');
    expect(target.status?.state).toBe('running');
  });

  it('marks the page unavailable when the plugin stops', async () => {
    host.PluginList.mockResolvedValue({ success: true, data: [status({ state: 'disabled', desiredEnabled: false })] });
    const target = await render();
    expect(target.available).toBe(false);
    expect(target.page?.id).toBe('overview');
  });

  it('marks the page unavailable when the plugin disappears or never declared it', async () => {
    host.PluginList.mockResolvedValueOnce({ success: true, data: [] });
    expect((await render()).available).toBe(false);
    unmount();
    host.PluginList.mockResolvedValueOnce({
      success: true,
      data: [status({}, [{ id: 'other', title: 'Other', body: { type: 'text', text: 'x' } }],
        [{ id: 'other-tools', title: 'Other', page: 'other', location: 'tools' }])],
    });
    const target = await render();
    expect(target.available).toBe(false);
    expect(target.page).toBeUndefined();
  });

  it('surfaces a host failure instead of pretending the page exists', async () => {
    host.PluginList.mockResolvedValue({ success: false, message: 'host down' });
    const target = await render();
    expect(target.loading).toBe(false);
    expect(target.error).toBe('host down');
    expect(target.available).toBe(false);
  });

  it('refreshes the plugin state while the tab stays open', async () => {
    host.PluginList.mockResolvedValue({ success: true, data: [status()] });
    await render();
    const calls = host.PluginList.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(host.PluginList.mock.calls.length).toBeGreaterThan(calls);
  });

  it('pauses polling while the window is hidden and refreshes when it returns', async () => {
    host.PluginList.mockResolvedValue({ success: true, data: [status()] });
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    try {
      await render();
      const calls = host.PluginList.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(host.PluginList.mock.calls.length).toBe(calls);
      visibility = 'visible';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(host.PluginList.mock.calls.length).toBe(calls + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(host.PluginList.mock.calls.length).toBe(calls + 2);
    } finally {
      delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  });
});
