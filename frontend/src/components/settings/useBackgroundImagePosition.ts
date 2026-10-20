import { useEffect, useRef, useState } from 'react';
import { useBackgroundImageStore } from '../../backgroundImageStore';
import type { BackgroundImagePosition } from '../../utils/backgroundImagePosition';

export function useBackgroundImagePosition(onError: (error: unknown) => void) {
  const positionX = useBackgroundImageStore((state) => state.previewPosition?.positionX ?? state.positionX);
  const positionY = useBackgroundImageStore((state) => state.previewPosition?.positionY ?? state.positionY);
  const pending = useRef<BackgroundImagePosition | null>(null);
  const preview = (x: number, y: number) => {
    const state = useBackgroundImageStore.getState();
    state.previewPositionAt(x, y);
    pending.current = useBackgroundImageStore.getState().previewPosition;
  };
  const commit = () => {
    const value = pending.current;
    pending.current = null;
    const state = useBackgroundImageStore.getState();
    // Removal, replacement or an external storage update invalidates this gesture.
    if (!value || value !== state.previewPosition) return;
    try {
      state.setPosition(value.positionX, value.positionY);
    } catch (error) {
      onError(error);
    }
  };
  return { position: { positionX, positionY }, preview, commit };
}

export function useBackgroundViewportRatio() {
  const readRatio = () => window.innerWidth / Math.max(1, window.innerHeight);
  const [ratio, setRatio] = useState(readRatio);
  useEffect(() => {
    const update = () => setRatio(readRatio());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return ratio;
}
