import { describe, expect, it, vi } from 'vitest';

import { installTabDetachDragGuards } from './TabManager';

type Listener = (event: Record<string, unknown>) => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type, ...event });
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakePointerCaptureTarget extends FakeEventTarget {
  private capturedPointers = new Set([7]);

  hasPointerCapture(pointerId: number) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId: number) {
    this.capturedPointers.delete(pointerId);
  }
}

class FakeClassList {
  private classNames = new Set<string>();

  add(className: string) {
    this.classNames.add(className);
  }

  remove(className: string) {
    this.classNames.delete(className);
  }

  contains(className: string) {
    return this.classNames.has(className);
  }
}

const installGuards = () => {
  const windowTarget = new FakeEventTarget();
  const captureTarget = new FakePointerCaptureTarget();
  const rootClassList = new FakeClassList();
  const onTerminalPointer = vi.fn();
  const cancelDndDrag = vi.fn();
  let active = true;
  let removeGuards = () => {};
  const onInterrupted = vi.fn(() => {
    active = false;
    removeGuards();
  });

  removeGuards = installTabDetachDragGuards({
    windowTarget: windowTarget as unknown as Window,
    captureTarget: captureTarget as unknown as HTMLElement,
    rootClassList: rootClassList as unknown as DOMTokenList,
    pointerId: 7,
    isCurrent: () => active,
    onTerminalPointer,
    onInterrupted,
    cancelDndDrag,
  });

  return {
    cancelDndDrag,
    captureTarget,
    onInterrupted,
    onTerminalPointer,
    removeGuards,
    rootClassList,
    windowTarget,
  };
};

describe('TabManager detach drag lifecycle', () => {
  it.each([
    ['window blur', 'window', 'blur', {}],
    ['released primary button', 'window', 'pointermove', { buttons: 0, pointerId: 7 }],
    ['lost pointer capture', 'capture', 'lostpointercapture', { pointerId: 7 }],
  ] as const)('cancels dnd-kit and clears guards after %s', (_label, target, type, event) => {
    const harness = installGuards();
    expect(harness.rootClassList.contains('gn-workbench-tab-detaching')).toBe(true);

    if (target === 'window') {
      harness.windowTarget.dispatch(type, event);
    } else {
      harness.captureTarget.dispatch(type, event);
    }

    expect(harness.onInterrupted).toHaveBeenCalledOnce();
    expect(harness.cancelDndDrag).toHaveBeenCalledOnce();
    expect(harness.windowTarget.listenerCount('pointermove')).toBe(0);
    expect(harness.windowTarget.listenerCount('pointerup')).toBe(0);
    expect(harness.windowTarget.listenerCount('pointercancel')).toBe(0);
    expect(harness.windowTarget.listenerCount('blur')).toBe(0);
    expect(harness.captureTarget.listenerCount('lostpointercapture')).toBe(0);
    expect(harness.captureTarget.hasPointerCapture(7)).toBe(false);
    expect(harness.rootClassList.contains('gn-workbench-tab-detaching')).toBe(false);
  });

  it('keeps normal terminal pointer recording under dnd-kit control', () => {
    const harness = installGuards();

    harness.windowTarget.dispatch('pointerup', {
      clientX: 320,
      clientY: 48,
      pointerId: 7,
      screenX: 1320,
      screenY: 88,
    });

    expect(harness.onTerminalPointer).toHaveBeenCalledWith({
      clientX: 320,
      clientY: 48,
      screenX: 1320,
      screenY: 88,
      type: 'pointerup',
    });
    expect(harness.onInterrupted).not.toHaveBeenCalled();
    expect(harness.cancelDndDrag).not.toHaveBeenCalled();

    harness.removeGuards();
  });

  it('ignores other pointers and removes every listener on unmount cleanup', () => {
    const harness = installGuards();

    harness.windowTarget.dispatch('pointermove', { buttons: 0, pointerId: 9 });
    harness.captureTarget.dispatch('lostpointercapture', { pointerId: 9 });
    expect(harness.onInterrupted).not.toHaveBeenCalled();

    harness.removeGuards();
    harness.removeGuards();

    expect(harness.windowTarget.listenerCount('pointermove')).toBe(0);
    expect(harness.windowTarget.listenerCount('pointerup')).toBe(0);
    expect(harness.windowTarget.listenerCount('pointercancel')).toBe(0);
    expect(harness.windowTarget.listenerCount('blur')).toBe(0);
    expect(harness.captureTarget.listenerCount('lostpointercapture')).toBe(0);
    expect(harness.captureTarget.hasPointerCapture(7)).toBe(false);
    expect(harness.rootClassList.contains('gn-workbench-tab-detaching')).toBe(false);

    harness.windowTarget.dispatch('blur');
    expect(harness.onInterrupted).not.toHaveBeenCalled();
    expect(harness.cancelDndDrag).not.toHaveBeenCalled();
  });
});
