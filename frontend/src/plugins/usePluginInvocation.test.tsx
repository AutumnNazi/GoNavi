import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ PluginList: vi.fn(), PluginInspect: vi.fn(), PluginInstall: vi.fn(),
  PluginSetEnabled: vi.fn(), PluginRemove: vi.fn(), PluginInvoke: vi.fn(), PluginOpenWindow: vi.fn(), PluginRuntimeInfo: vi.fn() }));
vi.mock('../../wailsjs/go/app/App', () => host);
import { usePluginInvocation } from './usePluginInvocation';
let invocation: ReturnType<typeof usePluginInvocation>;
let renderer: ReturnType<typeof create> | undefined;
function Harness({ generation, active }: { generation: number; active: boolean }) {
  invocation = usePluginInvocation('test.hello', generation, active); return null;
}
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; vi.resetAllMocks(); });
describe('invocation generation fencing', () => {
  it('ignores stale results after disable and after a new generation starts', async () => {
    let finish: (result: unknown) => void = () => {};
    host.PluginInvoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ success: true, data: { generation: 2 } });
    await act(async () => { renderer = create(<Harness generation={1} active />); });
    let previous: Promise<void>;
    await act(async () => { previous = invocation.invoke('hello', {}); });
    await act(async () => { renderer!.update(<Harness generation={1} active={false} />); });
    expect(invocation.result).toBe(''); expect(invocation.busy).toBe(false);
    await act(async () => { renderer!.update(<Harness generation={2} active />); });
    await act(async () => { await invocation.invoke('hello', {}); });
    await act(async () => { finish({ success: true, data: { stale: true } }); await previous!; });
    expect(invocation.result).toContain('"generation": 2');
    expect(invocation.result).not.toContain('stale');
  });
  it('does not invoke commands or open windows when revoked', async () => {
    await act(async () => { renderer = create(<Harness generation={1} active={false} />); });
    await act(async () => { await invocation.invoke('hello', {}); await invocation.openWindow(); });
    expect(host.PluginInvoke).not.toHaveBeenCalled(); expect(host.PluginOpenWindow).not.toHaveBeenCalled();
  });
});
