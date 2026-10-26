import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn() }));
vi.mock('./api', () => ({ packagedSkillAPI: api }));
import { usePackagedSkillCatalog, SKILL_REQUEST_TIMEOUT_MS } from './usePackagedSkillCatalog';
import { usePackagedSkillPreview } from './usePackagedSkillPreview';
import { invalidatePackagedSkillPreviews } from './invalidation';
const skill = { pluginId: 'example.docs', id: 'guide', name: 'Guide', description: 'Read-only guidance', entry: 'SKILL.md',
  version: '1.0.0', digest: 'a'.repeat(64), generation: 2, available: true };
let current!: { catalog: ReturnType<typeof usePackagedSkillCatalog>; preview: ReturnType<typeof usePackagedSkillPreview> };
let root: ReactTestRenderer | undefined;
function Harness({ active }: { active: boolean }) { const catalog = usePackagedSkillCatalog(active); const preview = usePackagedSkillPreview(catalog.items, active); current = { catalog, preview }; return null; }
const render = async (active: boolean) => { await act(async () => { if (root) root.update(<Harness active={active} />); else root = create(<Harness active={active} />); }); };
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); api.list.mockResolvedValue([skill]); api.read.mockResolvedValue({ content: 'Visible only after explicit preview.' }); });
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.useRealTimers(); });
describe('packaged document preview lifecycle', () => {
  it('fetches metadata only while open, never auto-reads a body', async () => {
    await render(false); expect(api.list).not.toHaveBeenCalled(); await render(true);
    expect(api.list).toHaveBeenCalledTimes(1); expect(api.read).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(api.list).toHaveBeenCalledTimes(2); expect(api.read).not.toHaveBeenCalled();
    await render(false); await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(api.list).toHaveBeenCalledTimes(2);
  });
  it('keeps unchanged snapshots readable but clears changed generations without reloading', async () => {
    await render(true); await act(async () => { await current.preview.preview(skill); }); expect(current.preview.content).toBeTruthy();
    await act(async () => { await current.catalog.refresh(); }); expect(current.preview.content).toBeTruthy();
    api.list.mockResolvedValue([{ ...skill, generation: 3 }]); await act(async () => { await current.catalog.refresh(); });
    expect(current.preview.content).toBeNull(); expect(current.preview.selection).toBeNull(); expect(api.read).toHaveBeenCalledTimes(1);
  });
  it('clears loaded text immediately on local disable/remove and on metadata failures', async () => {
    await render(true); await act(async () => { await current.preview.preview(skill); });
    act(() => invalidatePackagedSkillPreviews(skill.pluginId)); expect(current.preview.content).toBeNull(); expect(current.catalog.items[0].available).toBe(false);
    await act(async () => { await current.catalog.refresh(); await current.preview.preview(skill); });
    api.list.mockRejectedValue(new Error('offline')); await act(async () => { await current.catalog.refresh(); });
    expect(current.preview.content).toBeNull(); expect(current.catalog.items[0].available).toBe(false);
  });
  it.each(['close', 'hidden', 'revoked', 'new-generation'])('cancels public waits and ignores late body after %s', async (reason) => {
    let resolve: (value: { content: string }) => void = () => {};
    api.read.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await render(true); let pending!: Promise<void>;
    act(() => { pending = current.preview.preview(skill); });
    if (reason === 'close') act(() => current.preview.close());
    if (reason === 'hidden') await render(false);
    if (reason === 'revoked') act(() => invalidatePackagedSkillPreviews(skill.pluginId));
    if (reason === 'new-generation') { api.list.mockResolvedValue([{ ...skill, generation: 3 }]); await act(async () => { await current.catalog.refresh(); }); }
    await act(async () => { await pending; resolve({ content: 'LATE: must never appear' }); });
    expect(current.preview.content).toBeNull(); expect(current.preview.selection).toBeNull(); expect(api.read).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging preview wait and prevents duplicate underlying reads', async () => {
    api.read.mockImplementation(() => new Promise(() => {})); await render(true); let pending!: Promise<void>;
    act(() => { pending = current.preview.preview(skill); });
    await act(async () => { await vi.advanceTimersByTimeAsync(SKILL_REQUEST_TIMEOUT_MS + 1); await pending; });
    expect(current.preview.loading).toBe(false); expect(current.preview.error).toBe('plugin.skills.error.timeout');
    await current.preview.preview(skill); expect(api.read).toHaveBeenCalledTimes(1); expect(current.preview.content).toBeNull();
  });
  it('bounds catalog refresh waits without duplicating transport or overwriting timeout errors', async () => {
    await render(true); api.list.mockImplementation(() => new Promise(() => {})); let pending!: Promise<void>;
    act(() => { pending = current.catalog.refresh(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(SKILL_REQUEST_TIMEOUT_MS + 1); await pending; });
    expect(current.catalog.loading).toBe(false); expect(current.catalog.error).toBe('plugin.skills.error.timeout');
    await act(async () => { await current.catalog.refresh(); });
    expect(api.list).toHaveBeenCalledTimes(2); expect(current.catalog.error).toBe('plugin.skills.error.timeout');
    expect(current.catalog.items[0].available).toBe(false);
  });
  it('fences a late catalog after deactivation', async () => {
    let resolve: (value: typeof skill[]) => void = () => {};
    api.list.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await render(true); await render(false); await act(async () => { resolve([skill]); });
    expect(current.catalog.items).toEqual([]); expect(api.read).not.toHaveBeenCalled();
  });
});
