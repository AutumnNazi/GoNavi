import { Environment } from '../../wailsjs/runtime';

export type GalleryRuntime = 'desktop' | 'web' | 'unsupported';
interface RuntimeEnvironment { buildType?: string; platform?: string }
interface RuntimeMarkers {
  __GONAVI_WEB_RUNTIME__?: { buildType?: string };
  __GONAVI_NATIVE_DETACHED__?: unknown;
  __GONAVI_DETACHED_RUNTIME__?: { buildType?: string; capabilities?: { nativeWindow?: boolean; sharedBackend?: boolean } };
  __GONAVI_DETACHED__?: { active?: boolean };
}

export function classifyGalleryRuntime(environment: RuntimeEnvironment | null, markers: RuntimeMarkers = {}): GalleryRuntime {
  // An actual Web host always wins over bridge-shaped objects or a native platform string.
  if (environment?.buildType === 'web' || markers.__GONAVI_WEB_RUNTIME__?.buildType === 'web') return 'web';
  const detached = markers.__GONAVI_DETACHED_RUNTIME__;
  if (environment?.buildType === 'desktop-detached' || markers.__GONAVI_NATIVE_DETACHED__ === true
      || (detached?.buildType === 'desktop-detached' && detached.capabilities?.nativeWindow === true
        && detached.capabilities.sharedBackend === true)) return 'desktop';
  if (['dev', 'production'].includes(environment?.buildType ?? '')
      && ['darwin', 'windows', 'linux'].includes(environment?.platform ?? '')) return 'desktop';
  return 'unsupported';
}

export async function detectGalleryRuntime(): Promise<GalleryRuntime> {
  const markers = typeof window === 'undefined' ? {} : window as Window & RuntimeMarkers;
  let environment: RuntimeEnvironment | null = null;
  try { environment = await Environment(); } catch { /* Unidentified runtimes fail closed. */ }
  return classifyGalleryRuntime(environment, markers);
}
