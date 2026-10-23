import { createPluginBridge } from './bridge';
import { startPluginHeartbeat } from './heartbeat';
import { newPluginRequestID, type PluginWindowBridge } from './protocol';

declare global {
  interface Window { readonly gonaviPlugin: PluginWindowBridge }
}

// Build as a separate classic IIFE. This contains no plugin code and is never
// imported by the host entrypoint; the native child injects it before entry JS.
if (!Object.prototype.hasOwnProperty.call(window, 'gonaviPlugin')) {
  const fetcher = globalThis.fetch.bind(globalThis);
  const bridge = createPluginBridge(fetcher, newPluginRequestID);
  Object.defineProperty(window, 'gonaviPlugin', { value: bridge, writable: false, configurable: false });
  const stopHeartbeat = startPluginHeartbeat(fetcher);
  globalThis.addEventListener('pagehide', stopHeartbeat, { once: true });
}
