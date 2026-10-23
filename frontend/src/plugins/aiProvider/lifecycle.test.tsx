import React, { useEffect, useRef, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIPluginProviderScope, usePluginProviderCatalog } from './context';
import { decodePluginAIProviders } from './decode';
import { invalidatePluginAIProviders } from './invalidation';
import { buildPluginProviderPayload } from './editor';
import { useAISettingsProviderChecks } from '../../components/aiSettings/hooks/useAISettingsProviderChecks';
import type { UseAISettingsMcpAndPresetsInput } from '../../components/aiSettings/hooks/useAISettingsMcpAndPresets';
import type { AIProviderConfig } from '../../types';
import type { ProviderCheckResult } from '../../utils/aiProviderManagement';
const mocks = vi.hoisted(() => ({ list: vi.fn(), test: vi.fn() }));
vi.mock('./api', () => ({ fetchPluginAIProviders: mocks.list }));
const type = 'plugin:example.ai:chat';
const config: AIProviderConfig = { id: 'saved', type, name: 'Saved', model: 'model', apiKey: '', hasSecret: true, secretRef: 'private-ref', baseUrl: '', maxTokens: 0, temperature: 0.7 };
const catalog = (generation = 1) => decodePluginAIProviders({ items: [{ type, pluginId: 'example.ai', id: 'chat', name: 'Native provider', models: [{ id: 'model', name: 'Model', contextWindow: 4096, maxOutputTokens: 1024 }], supportsTools: true, supportsImages: false, version: '1.0.0', digest: 'a'.repeat(64), generation, available: true, state: 'running' }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
let current: ReturnType<typeof useAISettingsProviderChecks> & { catalog: NonNullable<ReturnType<typeof usePluginProviderCatalog>>; status: string; result: ProviderCheckResult | null; testing: boolean };
function Probe() {
  const metadata = usePluginProviderCatalog()!; const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<ProviderCheckResult | null>(null); const [testing, setTesting] = useState(false);
  const mountedRef = useRef(true); const activeRef = useRef(true); const editorSessionRef = useRef(1); const configRevisionRef = useRef(0); const testRequestRef = useRef(0);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const input = { mountedRef, activeRef, editorSessionRef, configRevisionRef, testRequestRef,
    form: { getFieldValue: (key: string) => config[key as keyof AIProviderConfig], validateFields: async () => config }, editingProvider: config,
    setProviderTesting: setTesting, setTestStatus: setStatus, setTestResult: setResult,
    buildProviderPayload: (values: Record<string, unknown>, purpose: 'save' | 'test') => buildPluginProviderPayload(values, config, purpose, metadata.find(type)),
    resolveAIService: async () => ({ AITestProvider: mocks.test }), t: (key: string) => key, messageApi: { error: vi.fn(), success: vi.fn() },
  } as unknown as UseAISettingsMcpAndPresetsInput;
  current = { ...useAISettingsProviderChecks(input), catalog: metadata, status, result, testing }; return null;
}
let renderer: ReactTestRenderer;
async function mount(active = true) { await act(async () => { renderer = create(<AIPluginProviderScope active={active}><Probe /></AIPluginProviderScope>); }); }
beforeEach(() => { vi.useFakeTimers(); mocks.list.mockReset().mockResolvedValue(catalog()); mocks.test.mockReset().mockResolvedValue({ success: true, checkKind: 'model-response', modelVerified: true, message: 'verified' }); });
afterEach(async () => { await act(async () => { renderer?.unmount(); }); vi.useRealTimers(); });
describe('real plugin catalog and provider-check lifecycle', () => {
  it('discovers metadata without an implicit model test and preserves confirmed results for unchanged snapshots', async () => {
    await mount(); expect(mocks.test).not.toHaveBeenCalled(); expect(current.catalog.items).toHaveLength(1);
    await act(async () => { await current.handleTestProvider(); }); expect(current.status).toBe('success');
    await act(async () => { await current.catalog.refresh(); }); expect(current.status).toBe('success'); expect(mocks.test).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled', 'removed', 'root'] as const)('revokes %s and ignores a late successful model response', async (reason) => {
    const response = deferred<ProviderCheckResult>(); mocks.test.mockReturnValue(response.promise); await mount();
    let pending!: Promise<void>; await act(async () => { pending = current.handleTestProvider(); }); expect(mocks.test).toHaveBeenCalledTimes(1);
    await act(async () => { invalidatePluginAIProviders({ reason, pluginId: reason === 'root' ? undefined : 'example.ai' }); });
    expect(current.status).toBe('idle'); expect(current.testing).toBe(false);
    await act(async () => { response.resolve({ success: true, checkKind: 'model-response', modelVerified: true, message: 'old' }); await pending; });
    expect(current.result).toBeNull(); expect(current.status).toBe('idle');
  });
  it('drops old catalog replies across root changes without extra physical requests', async () => {
    const response = deferred<ReturnType<typeof catalog>>(); mocks.list.mockReturnValueOnce(response.promise); await mount();
    await act(async () => { invalidatePluginAIProviders({ reason: 'root' }); await current.catalog.refresh(); });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await act(async () => { response.resolve(catalog()); }); expect(current.catalog.items).toHaveLength(0);
    await act(async () => { await current.catalog.refresh(); }); expect(current.catalog.items).toHaveLength(1);
  });
  it('invalidates a confirmed response after generation changes and does not retest', async () => {
    await mount(); await act(async () => { await current.handleTestProvider(); }); mocks.list.mockResolvedValue(catalog(2));
    await act(async () => { await current.catalog.refresh(); }); expect(current.status).toBe('idle'); expect(mocks.test).toHaveBeenCalledTimes(1);
  });
  it('rejects config-validation success instead of treating it as a real model response', async () => {
    await mount(); mocks.test.mockResolvedValue({ success: true, checkKind: 'local-auth', modelVerified: false, message: 'config valid' });
    await act(async () => { await current.handleTestProvider(); }); expect(current.status).toBe('error'); expect(current.result?.message).toBe('plugin.ai_provider.error.unverified');
  });
  it('bounds discovery waits and does not overwrite timeouts with duplicate polls', async () => {
    const response = deferred<ReturnType<typeof catalog>>(); mocks.list.mockReturnValue(response.promise); await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(current.catalog.error).toBe('plugin.ai_provider.error.timeout'); expect(mocks.list).toHaveBeenCalledTimes(1);
    await act(async () => { response.resolve(catalog()); }); expect(current.catalog.items).toHaveLength(0);
  });
  it('does not discover while inactive and fences pending metadata on close', async () => {
    await mount(false); expect(mocks.list).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<AIPluginProviderScope active><Probe /></AIPluginProviderScope>); }); expect(mocks.list).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.update(<AIPluginProviderScope active={false}><Probe /></AIPluginProviderScope>); }); expect(current.catalog.items).toHaveLength(0);
  });
});
