import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExporterChoice } from './useChoice';
import { decodePluginExporters } from './decode';
import { invalidatePluginContributions } from '../invalidation';
import { beginPluginExportOperation } from './operation';
import type { DataExportDialogValues } from '../../components/dataExportOptions';
const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('./api', () => ({ fetchPluginExporters: api.list }));
const format = 'plugin:sdk.example:ndjson';
const data = (generation = 1) => decodePluginExporters({ items: [{ format, pluginId: 'sdk.example', id: 'ndjson', name: 'NDJSON', extension: 'ndjson', contentType: 'application/x-ndjson', version: '1.0.0', digest: 'a'.repeat(64), generation, available: true, state: 'running' }] });
let current: ReturnType<typeof useExporterChoice> & { values: DataExportDialogValues }; let root: ReactTestRenderer;
function Probe({ active }: { active: boolean }) { const [values, setValues] = useState<DataExportDialogValues>({ format: 'xlsx', scope: 'page', columns: ['a'] }); current = { ...useExporterChoice(active, values, setValues), values }; return null; }
async function render(active = true) { await act(async () => { if (root) root.update(<Probe active={active} />); else root = create(<Probe active={active} />); }); }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>((yes) => { resolve = yes; }), resolve: (value: T) => resolve(value) }; }
beforeEach(() => { vi.useFakeTimers(); api.list.mockReset().mockResolvedValue(data()); });
afterEach(() => { act(() => root?.unmount()); root = undefined as unknown as ReactTestRenderer; vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('exporter explicit selection and lifecycle', () => {
  it('discovers only while active and never selects a plugin implicitly', async () => { await render(false); expect(api.list).not.toHaveBeenCalled(); await render(); expect(current.values.format).toBe('xlsx'); expect(current.values.pluginExporter).toBeUndefined(); });
  it('keeps an old pin and requires same-value explicit reselection after metadata changes', async () => {
    await render(); act(() => current.select(format)); expect(current.isCurrent()).toBe(true); expect(current.values.pluginExporter?.generation).toBe(1);
    api.list.mockResolvedValue(data(2)); await act(async () => { await current.catalog.refresh(); });
    expect(current.isCurrent()).toBe(false); expect(current.values.format).toBe(format); expect(current.values.pluginExporter?.generation).toBe(1);
    act(() => current.select(format)); expect(current.isCurrent()).toBe(true); expect(current.values.pluginExporter?.generation).toBe(2);
  });
  it.each(['disabled', 'removed', 'root'] as const)('invalidates %s even if a later catalog repeats the same pin', async (reason) => {
    await render(); act(() => current.select(format)); act(() => invalidatePluginContributions({ reason, pluginId: reason === 'root' ? 'unrelated.id' : 'sdk.example' }));
    expect(current.isCurrent()).toBe(false); await act(async () => { await current.catalog.refresh(); }); expect(current.isCurrent()).toBe(false);
    act(() => current.select(format)); expect(current.isCurrent()).toBe(true);
  });
  it('separates operation lifetime from the dialog closing after submit', async () => {
    await render(); act(() => current.select(format)); const operation = beginPluginExportOperation(format); await render(false);
    expect(current.isCurrent()).toBe(false); expect(operation.isCurrent()).toBe(true);
    act(() => invalidatePluginContributions({ reason: 'root', pluginId: 'other.id' })); expect(operation.isCurrent()).toBe(false); operation.release();
  });
  it('drops late metadata across root changes and keeps one physical request', async () => {
    const result = deferred<ReturnType<typeof data>>(); api.list.mockReturnValueOnce(result.promise); await render();
    act(() => invalidatePluginContributions({ reason: 'root' })); await act(async () => { await current.catalog.refresh(); }); expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve(data()); }); expect(current.catalog.items).toHaveLength(0);
  });
  it('settles bounded waits without accepting late replies or duplicate polls', async () => {
    const result = deferred<ReturnType<typeof data>>(); api.list.mockReturnValue(result.promise); await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(current.catalog.error).toBe('plugin.exporter.error.catalog_timeout'); expect(api.list).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve(data()); }); expect(current.catalog.items).toHaveLength(0);
  });
});
