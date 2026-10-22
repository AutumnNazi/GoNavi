import { describe, expect, it } from 'vitest';
import { Protocol } from '../src/protocol.js';
import type { RPCResponse } from '../src/types.js';
const initialize = { apiVersion: 1, pluginId: 'example.hello', version: '1.0.0', generation: 1, config: {}, hostVersion: '1.0.0', locale: 'en', permissions: [] };
const request = (id: number, method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('protocol result frame', () => {
  it('replaces a multibyte result that exceeds one mebibyte and keeps a small one', async () => {
    const replies: RPCResponse[] = [];
    const protocol = new Protocol({
      handlers: { small: () => '文'.repeat(100), large: () => '文'.repeat(400000) },
      send: (frame) => { replies.push(JSON.parse(frame)); },
    });
    protocol.accept(request(1, 'plugin.initialize', initialize));
    await tick();
    await protocol.flush();
    protocol.accept(request(2, 'plugin.invoke', { commandId: 'small', arguments: {} }));
    await tick();
    await protocol.flush();
    expect(JSON.stringify(replies.at(-1))).toContain('文');
    protocol.accept(request(3, 'plugin.invoke', { commandId: 'large', arguments: {} }));
    await tick();
    await protocol.flush();
    const last = replies.at(-1);
    expect(last?.error).toMatchObject({ code: -32603, message: 'response exceeds frame limit' });
    expect(JSON.stringify(last)).not.toContain('文文文');
    protocol.close();
  });
});
