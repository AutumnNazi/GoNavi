import type { JSONValue } from './types.js';

/** Injected only into a separate plugin WebView, never the main application. */
export interface PluginWindowBridge {
  readonly ready: Promise<{ pluginId: string; generation: number; title: string }>;
  invoke(command: string, args?: JSONValue, options?: { signal?: AbortSignal }): Promise<JSONValue>;
  close(): Promise<void>;
}
