import React from 'react';
import { createPortal } from 'react-dom';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AIProviderConfig } from '../../types';
import type { CLIModelCatalog } from '../../utils/aiProviderManagement';
import { isLocalCLISubscriptionProvider } from '../../utils/aiProviderPresets';
import ComposerModelMenu from './composerMenu/ComposerModelMenu';
import { thoughtMeterProgress } from './composerMenu/composerMenuModel';
import RollingLabel from './composerMenu/RollingLabel';
import { useComposerModelMenuState } from './composerMenu/useComposerModelMenuState';
import type { CLIThinkingCapability } from './useAIChatRuntimeResources';
import './composerMenu/composer-model-menu.css';

interface AIChatProviderModelSelectProps {
  activeProvider?: AIProviderConfig | null;
  providers?: AIProviderConfig[];
  providerModels?: Record<string, string[]>;
  dynamicModels: string[];
  loadingModels: boolean;
  onModelChange: (value: string) => void | Promise<void>;
  onProviderModelChange?: (providerId: string, model: string) => void | Promise<void>;
  onManageProvider?: (providerId: string) => void;
  onFetchModels: () => void;
  onFetchProviderModels?: (providerId: string) => void;
  thinkingIntensity?: string;
  onThinkingIntensityChange?: (value: string) => void;
  cliCapability?: CLIThinkingCapability;
  cliCatalog?: CLIModelCatalog;
}

type Translate = (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;

const ChevronDown: React.FC = () => (
  <svg className="gn-zcode-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style={{ transform: 'rotate(90deg)' }}>
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AIChatProviderModelMenu: React.FC<AIChatProviderModelSelectProps & { activeProvider: AIProviderConfig; t: Translate }> = ({
  activeProvider, providers, providerModels, dynamicModels, loadingModels, onModelChange, onProviderModelChange,
  onManageProvider, onFetchModels, onFetchProviderModels, thinkingIntensity, onThinkingIntensityChange,
  cliCapability, cliCatalog, t,
}) => {
  const state = useComposerModelMenuState({
    activeProvider, providers, providerModels, dynamicModels, thinkingIntensity, cliCapability, cliCatalog,
    onModelChange, onProviderModelChange, onManageProvider, onFetchModels, onFetchProviderModels, onThinkingIntensityChange,
    labelForLevel: (labelKey) => t(labelKey),
  }, loadingModels);
  const usesLocalCLI = isLocalCLISubscriptionProvider(activeProvider);
  const modelLabel = state.currentModel
    || (usesLocalCLI ? t('ai_settings.provider.auto_model') : t('ai_chat.input.model.placeholder'));
  const meter = thoughtMeterProgress(state.levels, state.effortValue);
  const providerName = activeProvider.name || activeProvider.id;
  return (
    <>
      <button
        ref={state.triggerRef}
        type="button"
        className="gn-v2-ai-model-select gn-v2-ai-provider-model-trigger"
        aria-label={`${providerName}: ${modelLabel}`}
        aria-haspopup="menu"
        aria-expanded={state.open}
        onClick={state.toggle}
      >
        <span className="gn-v2-ai-provider-model-label"><RollingLabel label={modelLabel} /></span>
        {state.levels.length > 0 ? (
          <span className="gn-zcode-thought-meter" data-testid="composer-thought-meter" data-progress={meter} aria-hidden="true">
            <span className="gn-zcode-thought-meter-fill" data-highspeed={state.highspeed || undefined} style={{ height: `${meter}%` }} />
          </span>
        ) : null}
        {loadingModels ? <span className="gn-zcode-spinner" role="status" aria-label={t('common.loading')} /> : <ChevronDown />}
      </button>
      {state.open && typeof document !== 'undefined' ? createPortal(
        <ComposerModelMenu
          groups={state.groups}
          activeProviderId={activeProvider.id}
          shownProviderId={state.shownId}
          currentModel={state.currentModel}
          narrow={state.narrow}
          providerOpen={state.providerOpen}
          loading={loadingModels}
          levels={state.levels}
          effortValue={state.effortValue}
          highspeed={state.highspeed}
          labels={{
            provider: t('ai_chat.input.model.provider'),
            models: t('ai_chat.input.model.models'),
            effort: t('ai_chat.input.thinking_intensity.label'),
            back: t('ai_chat.input.model.back'),
            manage: t('ai_settings.models.manage'),
            empty: t('ai_settings.models.sync_empty'),
            auto: t('ai_settings.provider.auto_model'),
            loading: t('common.loading'),
          }}
          menuStyle={state.menuStyle}
          submenuStyle={state.submenuStyle}
          menuRef={state.menuRef}
          submenuRef={state.submenuRef}
          onProviderOpenChange={state.setProviderOpen}
          onProviderHoverStart={state.hoverProviderStart}
          onProviderHoverEnd={state.hoverProviderEnd}
          onProviderPointerEnter={state.fetchProvider}
          onSelectProvider={state.selectProvider}
          onSelectModel={state.selectModel}
          onEffortChange={state.changeEffort}
          onManage={state.manage}
          onCloseProviders={state.closeProviders}
          onCloseMenu={state.closeMenu}
        />,
        document.body,
      ) : null}
    </>
  );
};

const AIChatProviderModelSelect: React.FC<AIChatProviderModelSelectProps> = (props) => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? ((key: string, params?: Record<string, string | number | boolean | null | undefined>) =>
    catalogTranslate('en-US', key, params));
  if (!props.activeProvider) return null;
  return <AIChatProviderModelMenu {...props} activeProvider={props.activeProvider} t={t} />;
};

export default AIChatProviderModelSelect;
