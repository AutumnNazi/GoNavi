import { describe, expect, it } from 'vitest';

import {
  canRetainExistingProviderSecret,
  isProviderSecretRequirementSatisfied,
  resolveProviderSecretDraft,
} from './providerSecretDraft';

describe('resolveProviderSecretDraft', () => {
  it('clears the stored provider secret when edit form leaves apiKey blank', () => {
    const result = resolveProviderSecretDraft({
      apiKeyInput: '',
    });

    expect(result.mode).toBe('clear');
    expect(result.apiKey).toBe('');
    expect(result.hasSecret).toBe(false);
  });

  it('replaces the provider secret when a new apiKey is entered', () => {
    const result = resolveProviderSecretDraft({
      apiKeyInput: ' sk-new ',
    });

    expect(result.mode).toBe('replace');
    expect(result.apiKey).toBe('sk-new');
    expect(result.hasSecret).toBe(true);
  });

  it('retains an existing API-provider secret when the edit form leaves the key blank', () => {
    expect(canRetainExistingProviderSecret({
      currentAuthMode: 'api-key',
      editingProvider: { authMode: 'api-key', hasSecret: true },
    })).toBe(true);

    expect(resolveProviderSecretDraft({
      apiKeyInput: '',
      retainExistingSecret: true,
    })).toEqual({
      mode: 'retain',
      apiKey: '',
      hasSecret: true,
    });
  });

  it('requires a new key when switching a local CLI provider to API authentication', () => {
    const editingProvider = {
      authMode: 'local-cli' as const,
      // Even stale metadata must not make a local subscription secret reusable
      // after switching to an API-key preset.
      hasSecret: true,
      secretRef: 'stale-local-secret',
      apiKey: 'stale-local-key',
    };

    expect(isProviderSecretRequirementSatisfied({
      apiKeyInput: '',
      currentAuthMode: 'api-key',
      editingProvider,
    })).toBe(false);
    expect(isProviderSecretRequirementSatisfied({
      apiKeyInput: 'sk-new',
      currentAuthMode: 'api-key',
      editingProvider,
    })).toBe(true);
  });

  it('does not treat an edit id alone as a retainable provider secret', () => {
    expect(isProviderSecretRequirementSatisfied({
      apiKeyInput: '',
      currentAuthMode: 'api-key',
      editingProvider: { authMode: 'api-key', hasSecret: false },
    })).toBe(false);

    expect(isProviderSecretRequirementSatisfied({
      apiKeyInput: '',
      currentAuthMode: 'api-key',
      editingProvider: { authMode: 'api-key', secretRef: 'ai/provider-1' },
    })).toBe(true);
  });
});
