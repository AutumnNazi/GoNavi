import { useEffect, useLayoutEffect } from 'react';
import { useResolvedBackground } from '../../backgroundGallery/useResolvedBackground';
import { BACKGROUND_IMAGE_STORAGE_KEY, useBackgroundImageStore } from '../../backgroundImageStore';
import './backgroundImage.css';

export default function BackgroundImageStyleHost() {
  const enabled = useBackgroundImageStore((state) => state.enabled);
  const resolved = useResolvedBackground();
  const image = enabled ? resolved : null;
  const opacity = useBackgroundImageStore((state) => state.opacity);
  const reload = useBackgroundImageStore((state) => state.reload);
  const positionX = useBackgroundImageStore((state) => state.previewPosition?.positionX ?? state.positionX);
  const positionY = useBackgroundImageStore((state) => state.previewPosition?.positionY ?? state.positionY);

  useLayoutEffect(() => {
    if (!image) return undefined;
    const root = document.querySelector<HTMLElement>('.gn-v2-app-root');
    if (!root) return undefined;
    root.style.setProperty('--gn-background-offset-x', `${positionX}vw`);
    root.style.setProperty('--gn-background-offset-y', `${positionY}vh`);
    return () => {
      root.style.removeProperty('--gn-background-offset-x');
      root.style.removeProperty('--gn-background-offset-y');
    };
  }, [image, positionX, positionY]);

  useLayoutEffect(() => {
    if (!image) return undefined;
    const root = document.querySelector<HTMLElement>('.gn-v2-app-root');
    if (!root) return undefined;
    root.setAttribute('data-background-image', 'true');
    root.style.setProperty('--gn-background-image', `url("${image.dataUrl}")`);
    root.style.setProperty('--gn-background-size', image.fit);
    root.style.setProperty('--gn-background-tint', `${100 - opacity}%`);
    return () => {
      root.removeAttribute('data-background-image');
      root.style.removeProperty('--gn-background-image');
      root.style.removeProperty('--gn-background-size');
      root.style.removeProperty('--gn-background-tint');
    };
  }, [image, opacity]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === BACKGROUND_IMAGE_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reload]);

  return null;
}
