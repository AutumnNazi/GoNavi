import type React from 'react';

export type SidebarTreeScrollBlock = 'nearest' | 'center';

export type SidebarTreeScrollRequest = {
  id: number;
  key: React.Key;
  scrollBlock: SidebarTreeScrollBlock;
};

export type SidebarTreeScrollOutcome = 'scrolled' | 'fallback' | 'cancelled';

/**
 * The virtual tree renders a row only after rc-virtual-list has scrolled to it, and
 * WebKit can take several frames to commit a large expansion. Keep waiting for
 * roughly half a second before falling back to a plain top-aligned scroll.
 */
export const SIDEBAR_TREE_SCROLL_MAX_ATTEMPTS = 30;

/**
 * rc-virtual-list resolves `scrollTo({ key })` over several layout passes (the
 * `auto` alignment only picks a direction on its first pass). Re-issuing the call on
 * every frame restarts that state machine, so the request is repeated only this
 * often, giving the list time to finish while still recovering if the key was not in
 * its data yet.
 */
export const SIDEBAR_TREE_SCROLL_REISSUE_EVERY_ATTEMPTS = 10;

const resolveInitialAlign = (block: SidebarTreeScrollBlock): 'auto' | 'top' => (
  block === 'center' ? 'top' : 'auto'
);

type FrameScheduler = (callback: () => void) => number;
type FrameCanceller = (handle: number) => void;

export type RunSidebarTreeScrollRequestArgs = {
  request: SidebarTreeScrollRequest;
  isCurrent: () => boolean;
  scrollTreeToKey: (key: React.Key, align: 'auto' | 'top' | 'bottom') => void;
  findRow: () => HTMLElement | null;
  onSettled: (outcome: SidebarTreeScrollOutcome) => void;
  requestFrame?: FrameScheduler;
  cancelFrame?: FrameCanceller;
  maxAttempts?: number;
};

const defaultRequestFrame: FrameScheduler = (callback) => (
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(() => callback())
    : (setTimeout(callback, 16) as unknown as number)
);

const defaultCancelFrame: FrameCanceller = (handle) => {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
};

/** Drives one scroll request to completion; returns a cancel function for effect cleanup. */
export const runSidebarTreeScrollRequest = ({
  request,
  isCurrent,
  scrollTreeToKey,
  findRow,
  onSettled,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  maxAttempts = SIDEBAR_TREE_SCROLL_MAX_ATTEMPTS,
}: RunSidebarTreeScrollRequestArgs): (() => void) => {
  let cancelled = false;
  let attempt = 0;
  let frameId: number | null = null;

  const finish = (outcome: SidebarTreeScrollOutcome) => {
    frameId = null;
    onSettled(outcome);
  };

  const attemptScroll = () => {
    if (cancelled || !isCurrent()) {
      finish('cancelled');
      return;
    }
    if (attempt % SIDEBAR_TREE_SCROLL_REISSUE_EVERY_ATTEMPTS === 0) {
      scrollTreeToKey(request.key, resolveInitialAlign(request.scrollBlock));
    }
    frameId = requestFrame(() => {
      if (cancelled || !isCurrent()) {
        finish('cancelled');
        return;
      }
      const row = findRow();
      if (row) {
        row.scrollIntoView?.({ block: request.scrollBlock, inline: 'nearest', behavior: 'auto' });
        finish('scrolled');
        return;
      }
      attempt += 1;
      if (attempt < maxAttempts) {
        frameId = requestFrame(attemptScroll);
        return;
      }
      // Row never rendered (e.g. height cache stale): let the virtual list place it itself.
      scrollTreeToKey(request.key, 'top');
      finish('fallback');
    });
  };

  frameId = requestFrame(attemptScroll);
  return () => {
    cancelled = true;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
  };
};
