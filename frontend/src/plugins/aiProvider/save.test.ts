import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAISettingsProviderSave } from '../../components/aiSettings/hooks/useAISettingsProviderSave';
import type { UseAISettingsProviderEditingInput } from '../../components/aiSettings/hooks/useAISettingsProviderEditing';
import { PluginAPIError } from '../apiResult';
import type { AIProviderConfig } from '../../types';
const provider: AIProviderConfig = { id: 'saved', type: 'plugin:example.ai:chat', name: 'Saved', apiKey: '', hasSecret: true, secretRef: 'ref', baseUrl: '', model: 'model', maxTokens: 0, temperature: 0.7 };
const error = vi.fn(); const save = vi.fn(); const editable = vi.fn();
function input(): UseAISettingsProviderEditingInput {
  return { saveRunningRef: { current: false }, editorSessionRef: { current: 1 }, configRevisionRef: { current: 0 }, mountedRef: { current: true }, activeRef: { current: true },
    messageApi: { error, success: vi.fn(), warning: vi.fn() }, t: (key: string) => 'translated:' + key, providers: [provider], editingProvider: provider,
    setProviderSaveMode: vi.fn(), setProviderSaving: vi.fn(), form: { validateFields: async () => provider, getFieldsValue: () => provider },
    resolveAIService: async () => ({ AISaveProvider: save, AIGetEditableProvider: editable }), applyProviderEditorSession: vi.fn(), loadProviders: vi.fn(),
  } as unknown as UseAISettingsProviderEditingInput;
}
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(undefined); editable.mockResolvedValue({ ...provider, apiKey: 'selected-secret', headers: { Authorization: 'selected-auth', 'X-Public': 'old' } }); vi.stubGlobal('window', { dispatchEvent: vi.fn() }); vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} }); });
afterEach(() => vi.unstubAllGlobals());
describe('plugin provider save errors and retained copy credentials', () => {
  it('translates feature validation keys before displaying a save failure', async () => {
    const handlers = useAISettingsProviderSave(input(), () => { throw new PluginAPIError('plugin.ai_provider.error.headers'); });
    await handlers.handleSaveProvider(); expect(error).toHaveBeenCalledWith('translated:plugin.ai_provider.error.headers'); expect(save).not.toHaveBeenCalled();
  });
  it.each([{ headers: undefined, expected: { Authorization: 'selected-auth', 'X-Public': 'old' } }, { headers: {}, expected: {} }, { headers: { 'X-Public': 'new' }, expected: { Authorization: 'selected-auth', 'X-Public': 'new' } }])('copies selected credentials but preserves explicit all-header clearing', async ({ headers, expected }) => {
    const handlers = useAISettingsProviderSave(input(), () => ({ ...provider, headers: headers as Record<string, string> | undefined })); await handlers.handleSaveProvider('copy');
    expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0][0]).toMatchObject({ type: provider.type, apiKey: 'selected-secret', headers: expected });
    expect(save.mock.calls[0][0].secretRef).toBeUndefined();
  });
  it('drops removed public headers and replaces secret aliases using HTTP case identity', async () => {
    editable.mockResolvedValue({ ...provider, apiKey: 'selected-secret', headers: { Authorization: 'old', 'X-Remove': 'old' } });
    await useAISettingsProviderSave(input(), () => ({ ...provider, headers: { 'X-New': 'new', authorization: 'rotated' } })).handleSaveProvider('copy');
    expect(save.mock.calls[0][0].headers).toEqual({ 'X-New': 'new', authorization: 'rotated' });
  });
  it('retains opaque secret headers for nonempty public snapshots and redacted aliases', async () => {
    editable.mockResolvedValue({ ...provider, apiKey: 'selected-secret', headers: { Authorization: 'old', 'X-Remove': 'old' } });
    await useAISettingsProviderSave(input(), () => ({ ...provider, headers: { 'X-New': 'new', authorization: '' } })).handleSaveProvider('copy');
    expect(save.mock.calls[0][0].headers).toEqual({ Authorization: 'old', 'X-New': 'new' });
  });
  it('copies a valid header-only plugin without requiring an API key', async () => {
    editable.mockResolvedValue({ ...provider, apiKey: '', headers: { Authorization: 'header-only' } });
    await useAISettingsProviderSave(input(), () => provider).handleSaveProvider('copy');
    expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0][0]).toMatchObject({ apiKey: '', headers: { Authorization: 'header-only' } });
  });
  it('allows explicitly clearing a header-only copy without carrying the old reference', async () => {
    editable.mockResolvedValue({ ...provider, apiKey: '', headers: { Authorization: 'header-only' } });
    await useAISettingsProviderSave(input(), () => ({ ...provider, headers: {} })).handleSaveProvider('copy');
    expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0][0]).toMatchObject({ apiKey: '', headers: {}, hasSecret: false });
    expect(save.mock.calls[0][0].secretRef).toBeUndefined(); expect(save.mock.calls[0][0].id).not.toBe(provider.id);
  });
  it('rejects unreadable claimed credentials and posted case-duplicate headers', async () => {
    editable.mockResolvedValue({ ...provider, apiKey: '', headers: { 'X-Public': 'not a secret' } });
    await useAISettingsProviderSave(input(), () => provider).handleSaveProvider('copy'); expect(save).not.toHaveBeenCalled();
    editable.mockResolvedValue({ ...provider, apiKey: 'selected-secret', headers: {} });
    await useAISettingsProviderSave(input(), () => ({ ...provider, headers: { Authorization: 'one', authorization: 'two' } })).handleSaveProvider('copy'); expect(save).not.toHaveBeenCalled();
  });
  it('does not borrow a different provider type after the selected saved record changes', async () => {
    editable.mockResolvedValue({ ...provider, type: 'openai', apiKey: 'unrelated-secret' });
    await useAISettingsProviderSave(input(), () => provider).handleSaveProvider('copy'); expect(save).not.toHaveBeenCalled();
  });
});
