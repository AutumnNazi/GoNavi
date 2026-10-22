import {
  boundedJSON, bridgePrefix, parseIdentity, PluginBridgeError, readBridgeResponse,
  type PluginInvokeOptions, type PluginWindowBridge,
} from './protocol';

export type FetchBridge = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function post(fetcher: FetchBridge, route: string, value: unknown, signal?: AbortSignal) {
  return fetcher(bridgePrefix + route, {
    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: boundedJSON(value), signal,
  });
}

export function createPluginBridge(fetcher: FetchBridge, newID: () => string): PluginWindowBridge {
  const ready = fetcher(bridgePrefix + 'bootstrap', {
    credentials: 'omit', cache: 'no-store', redirect: 'error',
  }).then(readBridgeResponse).then(parseIdentity);
  // Plugin scripts may subscribe later; avoid an unhandled startup rejection.
  void ready.catch(() => undefined);
  let pending = 0;

  const invoke = async (command: string, args: unknown = null, options: PluginInvokeOptions = {}) => {
    if (typeof command !== 'string' || !command || command.length > 256) {
      throw new PluginBridgeError('invalid_command');
    }
    if (pending >= 8) throw new PluginBridgeError('too_many_requests');
    const id = newID();
    const controller = new AbortController();
    const cancel = () => {
      controller.abort();
      // Explicit cancellation also works on native custom-scheme transports that
      // do not forward a browser's aborted HTTP request context to the host.
      void post(fetcher, 'cancel', { id }).catch(() => undefined);
    };
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = globalThis.setTimeout(cancel, 30_000);
    pending++;
    try {
      const response = await post(fetcher, 'invoke', { id, command, arguments: args }, controller.signal);
      return await readBridgeResponse(response);
    } finally {
      pending--;
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  };

  return Object.freeze({
    ready,
    invoke,
    close: async () => {
      const response = await post(fetcher, 'close', {});
      if (!response.ok) throw new PluginBridgeError('close_failed');
    },
  });
}
