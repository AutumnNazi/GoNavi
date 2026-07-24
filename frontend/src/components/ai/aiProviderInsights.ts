import type { AIProviderConfig } from '../../types';
import { isLocalCLISubscriptionProvider } from '../../utils/aiProviderPresets';
import type { AIInspectionTranslator } from './aiInspectionI18n';
import { translateInspectionCopy } from './aiInspectionI18n';

const DECLARED_MODEL_PREVIEW_LIMIT = 12;
const DYNAMIC_MODEL_PREVIEW_LIMIT = 20;

const sliceList = <T,>(items: T[], limit: number) => {
  const list = Array.isArray(items) ? items : [];
  return {
    items: list.slice(0, limit),
    truncated: list.length > limit,
    total: list.length,
  };
};

const trimText = (value: unknown): string => String(value || '').trim();

const hasProviderSecret = (provider: AIProviderConfig): boolean =>
  provider.hasSecret ?? Boolean(provider.secretRef || provider.apiKey);

const isLocalCLIProvider = (provider: AIProviderConfig): boolean =>
  isLocalCLISubscriptionProvider(provider);

const isBaseURLOptionalProvider = (provider: AIProviderConfig): boolean =>
  isLocalCLIProvider(provider)
  || (provider.type === 'custom' && trimText(provider.apiFormat) === 'codebuddy-cli');

const isModelOptionalProvider = (provider: AIProviderConfig): boolean =>
  isLocalCLIProvider(provider)
  || (provider.type === 'custom' && ['codebuddy-cli', 'cursor-agent'].includes(trimText(provider.apiFormat)));

const getProviderHost = (baseUrl: string): string => {
  const normalized = trimText(baseUrl);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized).host;
  } catch {
    return '';
  }
};

const buildProviderIssues = (provider: AIProviderConfig): string[] => {
  const issues: string[] = [];
  const hasSecret = hasProviderSecret(provider);
  const baseUrl = trimText(provider.baseUrl);
  const model = trimText(provider.model);
  const declaredModels = Array.isArray(provider.models)
    ? provider.models.map((item) => trimText(item)).filter(Boolean)
    : [];

  if (!isLocalCLIProvider(provider) && !hasSecret) {
    issues.push('missing_secret');
  }
  if (!isBaseURLOptionalProvider(provider) && !baseUrl) {
    issues.push('missing_base_url');
  }
  if (!isModelOptionalProvider(provider) && !model) {
    issues.push('missing_selected_model');
  }
  if (!isLocalCLIProvider(provider) && declaredModels.length === 0) {
    issues.push('missing_declared_models');
  }

  return issues;
};

export const buildAIProviderSnapshot = (params: {
  providers?: AIProviderConfig[];
  activeProviderId?: string | null;
  dynamicModels?: string[];
  translate?: AIInspectionTranslator;
}) => {
  const translate = params.translate;
  const providers = Array.isArray(params.providers) ? params.providers : [];
  const activeProviderId = trimText(params.activeProviderId);
  const dynamicModelPreview = sliceList(
    (Array.isArray(params.dynamicModels) ? params.dynamicModels : [])
      .map((item) => trimText(item))
      .filter(Boolean),
    DYNAMIC_MODEL_PREVIEW_LIMIT,
  );

  const providerSummaries = providers.map((provider) => {
    const declaredModelPreview = sliceList(
      (Array.isArray(provider.models) ? provider.models : [])
        .map((item) => trimText(item))
        .filter(Boolean),
      DECLARED_MODEL_PREVIEW_LIMIT,
    );
    const headerKeys = Object.keys(provider.headers || {})
      .map((item) => trimText(item))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    const issues = buildProviderIssues(provider);

    return {
      id: provider.id,
      name: trimText(provider.name),
      type: provider.type,
      apiFormat: trimText(provider.apiFormat) || 'openai',
      authMode: provider.authMode || 'api-key',
      active: provider.id === activeProviderId,
      baseUrl: trimText(provider.baseUrl),
      baseUrlHost: getProviderHost(provider.baseUrl),
      model: trimText(provider.model),
      declaredModelCount: declaredModelPreview.total,
      declaredModels: declaredModelPreview.items,
      declaredModelsTruncated: declaredModelPreview.truncated,
      hasSecret: hasProviderSecret(provider),
      hasHeaders: headerKeys.length > 0,
      headerKeys,
      maxTokens: Number(provider.maxTokens) || 0,
      temperature: Number(provider.temperature) || 0,
      issues,
      issueCount: issues.length,
      status: issues.length === 0 ? 'ready' : 'needs_attention',
    };
  });

  const activeProvider = providerSummaries.find((provider) => provider.active) || null;
  const providersNeedingAttention = providerSummaries.filter((provider) => provider.issueCount > 0);
  const providerHosts = Array.from(
    new Set(
      providerSummaries
        .map((provider) => provider.baseUrlHost)
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    hasActiveProvider: Boolean(activeProvider),
    activeProviderId,
    activeProvider,
    providerCount: providerSummaries.length,
    readyProviderCount: providerSummaries.length - providersNeedingAttention.length,
    providersNeedingAttentionCount: providersNeedingAttention.length,
    missingSecretCount: providerSummaries.filter((provider) => provider.issues.includes('missing_secret')).length,
    missingSelectedModelCount: providerSummaries.filter((provider) => provider.issues.includes('missing_selected_model')).length,
    missingBaseUrlCount: providerSummaries.filter((provider) => provider.issues.includes('missing_base_url')).length,
    providers: providerSummaries,
    providerHosts,
    dynamicModelCount: dynamicModelPreview.total,
    dynamicModels: dynamicModelPreview.items,
    dynamicModelsTruncated: dynamicModelPreview.truncated,
    message: providerSummaries.length === 0
      ? translateInspectionCopy(
        translate,
        'ai_chat.inspection.provider.message.empty',
        'No AI providers are configured',
      )
      : activeProvider
        ? activeProvider.issueCount > 0
          ? translateInspectionCopy(
            translate,
            'ai_chat.inspection.provider.message.active_needs_attention',
            `Using ${activeProvider.name || activeProvider.id}, but ${activeProvider.issueCount} items still need checking`,
            { provider: activeProvider.name || activeProvider.id, issueCount: activeProvider.issueCount },
          )
          : translateInspectionCopy(
            translate,
            'ai_chat.inspection.provider.message.active_ready',
            `${providerSummaries.length} providers are configured; using ${activeProvider.name || activeProvider.id}`,
            { count: providerSummaries.length, provider: activeProvider.name || activeProvider.id },
          )
        : translateInspectionCopy(
          translate,
          'ai_chat.inspection.provider.message.unselected',
          `${providerSummaries.length} providers are configured, but no active provider is selected`,
          { count: providerSummaries.length },
        ),
  };
};
