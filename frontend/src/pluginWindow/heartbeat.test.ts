import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPluginHeartbeat } from './heartbeat';
import type { FetchBridge } from './bridge';

afterEach(() => vi.useRealTimers());

describe('plugin document event-loop heartbeat', () => {
  it('advances only when document timers run and stops on disposal', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<FetchBridge>().mockImplementation(async () => new Response(null, { status: 204 }));
    const stop = startPluginHeartbeat(fetcher);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // No native/worker side heartbeat can advance the sequence while JS stalls.
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ sequence: 2 });
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts a hung probe and never accumulates overlapping probes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<FetchBridge>().mockImplementation(async (_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const stop = startPluginHeartbeat(fetcher);
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
