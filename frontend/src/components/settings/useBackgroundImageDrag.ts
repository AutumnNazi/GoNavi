import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { BackgroundImagePosition } from '../../utils/backgroundImagePosition';

interface DragOptions {
  disabled: boolean;
  resetKey: unknown;
  position: BackgroundImagePosition;
  onMove: (x: number, y: number) => void;
  onFinish: () => void;
}

interface DragSession {
  pointerId: number;
  target: HTMLDivElement;
  clientX: number;
  clientY: number;
  width: number;
  height: number;
  position: BackgroundImagePosition;
}

export function useBackgroundImageDrag(options: DragOptions) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<DragSession | null>(null);
  const finish = () => {
    const drag = session.current;
    session.current = null;
    if (drag) {
      try {
        if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
      } catch { /* Capture may already be lost when the window blurs. */ }
    }
    latest.current.onFinish();
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = session.current;
      if (!drag || event.pointerId !== drag.pointerId || latest.current.disabled) return;
      event.preventDefault();
      latest.current.onMove(
        drag.position.positionX + (event.clientX - drag.clientX) / drag.width * 100,
        drag.position.positionY + (event.clientY - drag.clientY) / drag.height * 100,
      );
    };
    const end = (event: PointerEvent) => {
      if (session.current?.pointerId === event.pointerId) finish();
    };
    const visibility = () => { if (document.visibilityState === 'hidden') finish(); };
    // Document listeners also work when capture is missing or fails in a WebView.
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.addEventListener('lostpointercapture', end);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', finish);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.removeEventListener('lostpointercapture', end);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', finish);
      finish();
    };
  }, [options.disabled, options.resetKey]);

  return (event: ReactPointerEvent<HTMLDivElement>) => {
    if (latest.current.disabled || session.current || event.button !== 0 || event.isPrimary === false) return;
    const target = event.currentTarget;
    const { width, height } = target.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    event.preventDefault();
    session.current = {
      pointerId: event.pointerId, target, width, height,
      clientX: event.clientX, clientY: event.clientY, position: latest.current.position,
    };
    try { target.setPointerCapture?.(event.pointerId); } catch { /* Document fallback remains active. */ }
  };
}
