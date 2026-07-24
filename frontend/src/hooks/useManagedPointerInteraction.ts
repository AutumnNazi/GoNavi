import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

type ManagedPointerInteractionOptions = {
  onMove: (event: PointerEvent) => void;
  onStop?: () => void;
};

export const useManagedPointerInteraction = (active = true) => {
  const stopInteractionRef = useRef<(() => void) | null>(null);

  const stopInteraction = useCallback(() => {
    stopInteractionRef.current?.();
  }, []);

  useEffect(() => {
    if (!active) {
      stopInteraction();
    }
  }, [active, stopInteraction]);

  useEffect(() => stopInteraction, [stopInteraction]);

  const startInteraction = useCallback((
    event: ReactPointerEvent,
    options: ManagedPointerInteractionOptions,
  ): boolean => {
    if (!active || event.button !== 0) return false;

    stopInteraction();
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (moveEvent.buttons === 0) {
        stop();
        return;
      }
      options.onMove(moveEvent);
    };

    const stop = (stopEvent?: PointerEvent) => {
      if (stopEvent && stopEvent.pointerId !== pointerId) return;
      if (stopInteractionRef.current !== stop) return;
      stopInteractionRef.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', handleWindowBlur);
      captureTarget.removeEventListener('lostpointercapture', handleLostPointerCapture);
      try {
        if (captureTarget.hasPointerCapture(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }
      } catch {
        // Capture may already be gone after blur, cancellation, or unmount.
      }
      options.onStop?.();
    };

    const handleWindowBlur = () => stop();
    const handleLostPointerCapture = (lostEvent: Event) => {
      if ((lostEvent as PointerEvent).pointerId === pointerId) {
        stop();
      }
    };

    stopInteractionRef.current = stop;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', handleWindowBlur);
    captureTarget.addEventListener('lostpointercapture', handleLostPointerCapture);
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // Some embedded WebViews can remove the source element during pointerdown.
    }
    return true;
  }, [active, stopInteraction]);

  return { startInteraction, stopInteraction };
};
