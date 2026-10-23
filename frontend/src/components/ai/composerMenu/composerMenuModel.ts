import type { AIProviderConfig } from '../../../types';
import { enabledProviderModels } from '../../../utils/aiProviderManagement';
import { isLocalCLISubscriptionProvider } from '../../../utils/aiProviderPresets';

export interface ComposerProviderGroup {
  provider: AIProviderConfig;
  models: string[];
  usesLocalCLI: boolean;
}

const NO_THOUGHT_LEVELS = new Set([
  'disabled', 'false', 'no', 'none', 'nothink', 'no-think', 'no_think', 'off',
]);

export const isNoThoughtLevel = (value: string): boolean =>
  NO_THOUGHT_LEVELS.has(value.trim().toLowerCase());

// 只按显示名判断，避免供应商名或内部 id 带 highspeed 时误开高速动效。
export const isGlmHighspeedModel = (name: string): boolean =>
  /glm/i.test(name) && /highspeed|flashx/i.test(name);

export const connectedProviders = (
  providers: AIProviderConfig[] | undefined,
  activeProvider: AIProviderConfig,
): AIProviderConfig[] => {
  const available = Array.isArray(providers) ? providers.filter((provider) => Boolean(provider?.id)) : [];
  if (available.some((provider) => provider.id === activeProvider.id)) return available;
  return [activeProvider, ...available];
};

export const modelsForProvider = (
  provider: AIProviderConfig,
  activeProviderId: string,
  dynamicModels: string[],
  discoveredModels: string[] = [],
): string[] => enabledProviderModels(
  [
    ...(provider.id === activeProviderId && dynamicModels.length > 0
      ? dynamicModels
      : discoveredModels.length > 0 ? discoveredModels : (provider.models || [])),
    ...(provider.customModels || []),
    ...(String(provider.model || '').trim() ? [String(provider.model).trim()] : []),
  ],
  provider.disabledModels,
);

export const buildProviderGroups = (
  providers: AIProviderConfig[] | undefined,
  activeProvider: AIProviderConfig,
  dynamicModels: string[],
  providerModels: Record<string, string[]> | undefined,
): ComposerProviderGroup[] => connectedProviders(providers, activeProvider).map((provider) => ({
  provider,
  usesLocalCLI: isLocalCLISubscriptionProvider(provider),
  models: modelsForProvider(provider, activeProvider.id, dynamicModels, providerModels?.[provider.id]),
}));

export const modelChoices = (group: ComposerProviderGroup): string[] => (
  group.usesLocalCLI ? ['', ...group.models.filter((model) => model !== '')] : group.models
);

export const pickModelForProvider = (
  group: ComposerProviderGroup,
  currentModel: string,
): string | null => {
  const choices = modelChoices(group);
  if (choices.length === 0) return null;
  if (choices.includes(currentModel)) return currentModel;
  return choices[0];
};

export const thoughtMeterProgress = (
  levels: readonly { value: string }[],
  value: string,
): number => {
  const thinking = levels.filter((level) => !isNoThoughtLevel(level.value));
  if (thinking.length === 0 || isNoThoughtLevel(value)) return 0;
  const index = thinking.findIndex((level) => level.value === value);
  if (index < 0) return 0;
  return ((index + 1) / thinking.length) * 100;
};
