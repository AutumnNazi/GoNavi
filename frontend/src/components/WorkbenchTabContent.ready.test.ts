import { afterEach, describe, expect, it, vi } from 'vitest';

import { waitForWorkbenchContentReady } from './WorkbenchTabContent';

describe('WorkbenchTabContent readiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for the Monaco fallback to disappear before reporting detached content ready', () => {
    let pending = true;
    const observerState: { callback?: MutationCallback } = {};
    const disconnect = vi.fn();
    class TestMutationObserver {
      constructor(callback: MutationCallback) {
        observerState.callback = callback;
      }

      observe() {}

      disconnect() {
        disconnect();
      }
    }
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('document', { documentElement: {} });
    const root = {
      querySelector: vi.fn(() => pending ? ({}) as Element : null),
    };
    const onReady = vi.fn();

    const cleanup = waitForWorkbenchContentReady(onReady, root);

    expect(onReady).not.toHaveBeenCalled();
    pending = false;
    observerState.callback?.([], {} as MutationObserver);
    expect(onReady).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();

    cleanup();
  });
});
