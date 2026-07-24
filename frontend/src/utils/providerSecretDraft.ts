import type { AIProviderConfig } from '../types';

export type ProviderSecretDraftMode = 'replace' | 'retain' | 'clear';

type ProviderSecretSource = Partial<Pick<
  AIProviderConfig,
  'authMode' | 'apiKey' | 'hasSecret' | 'secretRef'
>>;

export interface ProviderSecretDraftInput {
  apiKeyInput?: string;
  retainExistingSecret?: boolean;
}

export interface ProviderSecretDraftResult {
  mode: ProviderSecretDraftMode;
  apiKey: string;
  hasSecret: boolean;
}

export interface ProviderSecretRequirementInput {
  apiKeyInput?: string;
  currentAuthMode?: AIProviderConfig['authMode'];
  editingProvider?: ProviderSecretSource | null;
  allowEmptySecret?: boolean;
}

const isLocalCLIAuthMode = (authMode: unknown): boolean =>
  String(authMode || '').trim().toLowerCase() === 'local-cli';

export const hasRetainableProviderSecret = (provider?: ProviderSecretSource | null): boolean =>
  provider?.hasSecret === true
  || Boolean(String(provider?.secretRef || '').trim())
  || Boolean(String(provider?.apiKey || '').trim());

export const canRetainExistingProviderSecret = ({
  currentAuthMode,
  editingProvider,
}: Pick<ProviderSecretRequirementInput, 'currentAuthMode' | 'editingProvider'>): boolean =>
  !isLocalCLIAuthMode(currentAuthMode)
  && !isLocalCLIAuthMode(editingProvider?.authMode)
  && hasRetainableProviderSecret(editingProvider);

export const isProviderSecretRequirementSatisfied = ({
  apiKeyInput,
  currentAuthMode,
  editingProvider,
  allowEmptySecret = false,
}: ProviderSecretRequirementInput): boolean =>
  Boolean(String(apiKeyInput || '').trim())
  || allowEmptySecret
  || isLocalCLIAuthMode(currentAuthMode)
  || canRetainExistingProviderSecret({ currentAuthMode, editingProvider });

export function resolveProviderSecretDraft(input: ProviderSecretDraftInput): ProviderSecretDraftResult {
  const apiKey = String(input.apiKeyInput || '').trim();

  if (apiKey) {
    return {
      mode: 'replace',
      apiKey,
      hasSecret: true,
    };
  }

  if (input.retainExistingSecret) {
    return {
      mode: 'retain',
      apiKey: '',
      hasSecret: true,
    };
  }

  return {
    mode: 'clear',
    apiKey: '',
    hasSecret: false,
  };
}
