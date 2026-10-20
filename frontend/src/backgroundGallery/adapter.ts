import type { GalleryAdapter } from './types';
import { detectGalleryRuntime } from './runtime';

let adapterPromise: Promise<GalleryAdapter> | undefined;
let listening = false;
export function disposeGalleryAdapter(): void {
  const pending = adapterPromise; adapterPromise = undefined;
  void pending?.then(adapter => adapter.dispose()).catch(() => undefined);
}
function installLifecycle(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', event => { if (!event.persisted) disposeGalleryAdapter(); });
}
export function getGalleryAdapter(): Promise<GalleryAdapter> {
  installLifecycle();
  if (!adapterPromise) {
    adapterPromise = (async () => {
      const runtime = await detectGalleryRuntime();
      if (runtime === 'desktop') return (await import('./desktopAdapter')).createDesktopGalleryAdapter();
      if (runtime === 'web') return (await import('./webAdapter')).createWebGalleryAdapter();
      throw Object.assign(new Error('unsupported_environment'), { code: 'unsupported_environment' });
    })().catch(error => { adapterPromise = undefined; throw error; });
  }
  return adapterPromise;
}
