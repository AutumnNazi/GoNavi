import { describe, expect, it, vi } from 'vitest';

import {
  SIDEBAR_TREE_SCROLL_MAX_ATTEMPTS,
  SIDEBAR_TREE_SCROLL_REISSUE_EVERY_ATTEMPTS,
  runSidebarTreeScrollRequest,
} from './sidebarTreeScrollRequest';

const createFrameQueue = () => {
  const queue: Array<{ id: number; callback: () => void }> = [];
  let nextId = 1;
  return {
    requestFrame: (callback: () => void) => {
      const id = nextId;
      nextId += 1;
      queue.push({ id, callback });
      return id;
    },
    cancelFrame: vi.fn((handle: number) => {
      const index = queue.findIndex((entry) => entry.id === handle);
      if (index >= 0) queue.splice(index, 1);
    }),
    flush: (count = Infinity) => {
      let flushed = 0;
      while (queue.length > 0 && flushed < count) {
        queue.shift()!.callback();
        flushed += 1;
      }
    },
    pending: () => queue.length,
  };
};

describe('runSidebarTreeScrollRequest', () => {
  it('scrolls the virtual list first and then the rendered row into view', () => {
    const frames = createFrameQueue();
    const scrollIntoView = vi.fn();
    const scrollTreeToKey = vi.fn();
    const onSettled = vi.fn();
    runSidebarTreeScrollRequest({
      request: { id: 1, key: 'conn-db-table', scrollBlock: 'center' },
      isCurrent: () => true,
      scrollTreeToKey,
      findRow: () => ({ scrollIntoView } as unknown as HTMLElement),
      onSettled,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.flush();
    // Centered requests ask the virtual list for a top-aligned jump (single pass) and
    // then center the rendered row themselves.
    expect(scrollTreeToKey).toHaveBeenCalledTimes(1);
    expect(scrollTreeToKey).toHaveBeenCalledWith('conn-db-table', 'top');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'auto' });
    expect(onSettled).toHaveBeenCalledWith('scrolled');
  });

  it('uses the multi-pass auto alignment for nearest requests', () => {
    const frames = createFrameQueue();
    const scrollTreeToKey = vi.fn();
    runSidebarTreeScrollRequest({
      request: { id: 6, key: 'row', scrollBlock: 'nearest' },
      isCurrent: () => true,
      scrollTreeToKey,
      findRow: () => ({ scrollIntoView: vi.fn() } as unknown as HTMLElement),
      onSettled: vi.fn(),
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.flush();
    expect(scrollTreeToKey).toHaveBeenCalledWith('row', 'auto');
  });

  it('does not restart the list scroll on every frame while waiting for the row', () => {
    const frames = createFrameQueue();
    const scrollTreeToKey = vi.fn();
    const onSettled = vi.fn();
    runSidebarTreeScrollRequest({
      request: { id: 2, key: 'late-row', scrollBlock: 'center' },
      isCurrent: () => true,
      scrollTreeToKey,
      findRow: () => null,
      onSettled,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.flush();
    expect(SIDEBAR_TREE_SCROLL_MAX_ATTEMPTS).toBeGreaterThanOrEqual(30);
    // Initial request, one re-issue every 10 attempts, plus the final fallback.
    expect(scrollTreeToKey).toHaveBeenCalledTimes(
      Math.ceil(SIDEBAR_TREE_SCROLL_MAX_ATTEMPTS / SIDEBAR_TREE_SCROLL_REISSUE_EVERY_ATTEMPTS) + 1,
    );
    expect(scrollTreeToKey).toHaveBeenLastCalledWith('late-row', 'top');
    expect(onSettled).toHaveBeenCalledWith('fallback');
  });

  it('finds the row on a later attempt once the tree has rendered it', () => {
    const frames = createFrameQueue();
    const scrollIntoView = vi.fn();
    let rendered = 0;
    const onSettled = vi.fn();
    runSidebarTreeScrollRequest({
      request: { id: 3, key: 'row', scrollBlock: 'nearest' },
      isCurrent: () => true,
      scrollTreeToKey: vi.fn(),
      findRow: () => {
        rendered += 1;
        return rendered >= 8 ? ({ scrollIntoView } as unknown as HTMLElement) : null;
      },
      onSettled,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('scrolled');
  });

  it('stops when a newer request supersedes it or the effect is cleaned up', () => {
    const frames = createFrameQueue();
    let current = true;
    const onSettled = vi.fn();
    const cancel = runSidebarTreeScrollRequest({
      request: { id: 4, key: 'stale', scrollBlock: 'center' },
      isCurrent: () => current,
      scrollTreeToKey: vi.fn(),
      findRow: () => null,
      onSettled,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.flush(3);
    current = false;
    frames.flush(1);
    expect(onSettled).toHaveBeenCalledWith('cancelled');

    const onSettled2 = vi.fn();
    const cancel2 = runSidebarTreeScrollRequest({
      request: { id: 5, key: 'cleanup', scrollBlock: 'center' },
      isCurrent: () => true,
      scrollTreeToKey: vi.fn(),
      findRow: () => null,
      onSettled: onSettled2,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    cancel2();
    expect(frames.cancelFrame).toHaveBeenCalled();
    frames.flush();
    expect(onSettled2).not.toHaveBeenCalledWith('scrolled');
    cancel();
  });
});
