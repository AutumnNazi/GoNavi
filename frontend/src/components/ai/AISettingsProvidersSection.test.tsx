import React from 'react';
import { Form } from 'antd';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AIProviderConfig } from '../../types';
import { t as catalogTranslate } from '../../i18n/catalog';
import { I18nProvider } from '../../i18n/provider';
import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AISettingsProvidersSection from './AISettingsProvidersSection';

const REQUIRED_KEYS = [
  'ai_settings.provider.catalog',
  'ai_settings.provider.action.add',
  'ai_settings.provider.empty.title',
  'ai_settings.provider.builtin',
  'ai_settings.provider.partners',
  'ai_settings.provider.partner.hualong.benefit',
  'ai_settings.provider.partner.promo_label',
  'ai_settings.provider.partner.copying',
  'ai_settings.provider.partner.copy_failed',
  'ai_settings.provider.partner.copy_action',
  'ai_settings.provider.partner.apply_base_url_action',
  'ai_settings.provider.partner.base_url_applied',
  'ai_settings.provider.partner.visit_action',
  'ai_settings.form.display_name',
  'ai_settings.form.provider',
  'ai_settings.form.auth_method',
  'ai_settings.form.auth_codex_subscription',
  'ai_settings.form.custom_headers',
  'ai_settings.form.cli_path',
  'ai_settings.form.cli_path_auto',
  'ai_settings.form.cli_path_manual',
  'ai_settings.form.cli_path_placeholder',
  'ai_settings.form.cli_path_hint',
  'ai_settings.form.cli_path_hint_manual',
  'ai_settings.form.default_model',
  'ai_settings.form.model_catalog.upstream',
  'ai_settings.form.inline_completion_model',
  'ai_settings.models.sync_upstream',
  'ai_settings.models.sync_cli',
  'ai_settings.models.sync_cli_success',
  'ai_settings.models.sync_cli_failed',
  'ai_settings.models.sync_cli_empty',
  'ai_settings.models.sync_success',
  'ai_settings.models.sync_failed',
  'ai_settings.models.sync_empty',
  'ai_settings.provider.save_changes',
  'ai_settings.action.test',
  'ai_settings.test.error.details',
  'ai_settings.test.error.hide',
  'ai_settings.test.error.copy',
  'ai_settings.test.error.copied',
  'common.edit',
  'common.cancel',
] as const;

const providerPresets: React.ComponentProps<typeof AISettingsProvidersSection>['providerPresets'] = [
  { key: 'openai', backendType: 'openai', label: 'OpenAI', icon: <span>O</span>, desc: 'GPT', defaultBaseUrl: 'https://api.openai.com/v1' },
  { key: 'deepseek', backendType: 'openai', label: 'DeepSeek', icon: <span>D</span>, desc: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', defaultApiFormat: 'openai-responses' },
  { key: 'anthropic', backendType: 'anthropic', label: 'Claude', icon: <span>A</span>, desc: 'Claude', defaultBaseUrl: 'https://api.anthropic.com' },
  { key: 'custom', backendType: 'custom', label: 'Custom', icon: <span>C</span>, desc: 'Custom API', defaultBaseUrl: '' },
];

const provider: AIProviderConfig = {
  id: 'provider-1',
  name: 'OpenAI',
  type: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxTokens: 4096,
  temperature: 0.7,
};

const overlayTheme = buildOverlayWorkbenchTheme(false);
const providerStyles = readFileSync(new URL('./AISettingsProvidersSection.css', import.meta.url), 'utf8');

const wrap = (props: Partial<React.ComponentProps<typeof AISettingsProvidersSection>> = {}) => {
  const Wrap = () => {
    const [form] = Form.useForm();
    return (
      <I18nProvider preference="en-US" systemLanguages={['en-US']} onPreferenceChange={() => {}}>
        <AISettingsProvidersSection
          providers={[provider]}
          activeProviderId="provider-1"
          editingProvider={null}
          isEditing={false}
          form={form}
          providerPresets={providerPresets}
          loading={false}
          testStatus="idle"
          primaryPasswordVisible={false}
          darkMode={false}
          overlayTheme={overlayTheme}
          cardBg="#fff"
          cardBorder="rgba(0,0,0,0.08)"
          onPrimaryPasswordVisibleChange={() => {}}
          resolveProviderPreset={() => ({ key: 'openai', label: 'OpenAI', icon: <span>O</span> })}
          resolvePresetByKey={(key) => providerPresets.find((item) => item.key === key) || providerPresets[0]}
          onAddProvider={() => {}}
          onEditProvider={() => {}}
          onDeleteProvider={() => {}}
          onSetActiveProvider={() => {}}
          onCancelEdit={() => {}}
          onPresetChange={() => {}}
          onAuthModeChange={() => {}}
          onTestProvider={() => {}}
          onSaveProvider={() => {}}
          {...props}
        />
      </I18nProvider>
    );
  };
  return renderToStaticMarkup(<Wrap />);
};

describe('AISettingsProvidersSection', () => {
  it('inherits control surfaces and states from the active GoNavi theme', () => {
    expect(providerStyles).toContain('--provider-control-bg: var(--gn-bg-panel-2');
    expect(providerStyles).toContain('background: var(--provider-control-bg) !important');
    expect(providerStyles).toContain('border-color: var(--gn-accent, var(--provider-active)) !important');
    expect(providerStyles).toContain('background: var(--gn-bg-selected, var(--ant-control-item-bg-active)) !important');
    expect(providerStyles).toContain('.ant-select-dropdown.gonavi-ai-model-management-popup');
    expect(providerStyles).toContain('.gonavi-ai-provider-model-sync');
    expect(providerStyles).toContain('.gonavi-ai-provider-cli-path-field { width: min(100%, 680px); }');
    expect(providerStyles).toContain('.gonavi-ai-provider-cli-path-mode.is-auto');
    expect(providerStyles).toContain('.gonavi-ai-provider-footer { flex-shrink: 0; display: flex; flex-direction: column; min-width: 0; }');
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-actions \{[^}]*flex-wrap: nowrap;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-test-result-summary \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-test-error-disclosure \{[^}]*justify-content: flex-end;[^}]*min-width: 0;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-test-result-toggle,[^{]*\{[^}]*max-width: 100%;[^}]*text-overflow: ellipsis;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-test-error-body \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
  });

  it('lets enlarged model actions define the form label row height without clipping', () => {
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-editor \.ant-form-item-label \{[^}]*overflow: visible;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-editor \.ant-form-item-label \{[^}]*width: 100%;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-editor \.ant-form-item-label \{[^}]*align-self: stretch;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-editor \.ant-form-item-label > label \{[^}]*display: flex;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-editor \.ant-form-item-label > label \{[^}]*height: auto/);
    expect(providerStyles).toContain('.gonavi-ai-provider-basic-fields > .ant-form-item .ant-form-item-label > label { min-height: 32px; }');
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-model-label \{[^}]*width: 100%;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-model-meta \{[^}]*margin-left: auto;/);
  });

  it('centers provider rows and partner badges independently of custom UI font metrics', () => {
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-preset-dropdown \.ant-select-item-option-content \{[^}]*display: flex;[^}]*align-items: center;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-preset-option \{[^}]*display: flex;[^}]*align-items: center;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-partner-option \{[^}]*align-items: center;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-partner-main \{[^}]*align-items: center;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-partner-benefit \{[^}]*transform: none;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-partner-benefit-text \{[^}]*transform: translateY\(\.5px\);/);
  });

  it('uses catalog keys for the list/edit chrome', () => {
    for (const key of REQUIRED_KEYS) {
      expect(catalogTranslate('en-US', key)).not.toBe(key);
      expect(catalogTranslate('zh-CN', key)).not.toBe(key);
    }
  });

  it('renders configured-provider chips beside the restored catalog', () => {
    const markup = wrap();
    expect(markup).toContain('Provider catalog');
    expect(markup).toContain('gonavi-ai-provider-chips');
    expect(markup).toContain('gonavi-ai-provider-row gonavi-ai-provider-chip is-active');
    expect(markup).toContain('is-draggable');
    expect(markup).toContain('gonavi-ai-provider-add-preset-select');
    expect(markup).toContain('Default');
    expect(markup).not.toContain('gonavi-ai-provider-config-card');
  });

  it('renders the restored empty chip state when there are no configurations', () => {
    const markup = wrap({ providers: [] });
    expect(markup).toContain('gonavi-ai-provider-empty');
    expect(markup).toContain('No model provider configured');
    expect(markup).not.toContain('gonavi-ai-provider-config-empty');
  });

  it('renders the connected tree node as a full-width configured-provider list', () => {
    const markup = wrap({ treeHostedView: 'connected' });
    expect(markup).toContain('is-connected-only');
    expect(markup).toContain('data-connected-list="true"');
    expect(markup).toContain('gonavi-ai-provider-connected-title');
    expect(markup).toContain('gonavi-ai-provider-connected-hint');
    expect(markup).toContain('gpt-4o');
    expect(markup).toContain('/icons/ai/openai.svg');
    expect(markup).toContain('Search name, provider or model');
    expect(markup).not.toContain('gonavi-ai-provider-density');
    expect(markup).not.toContain('gonavi-ai-provider-config-card');
    expect(markup).not.toContain('Provider catalog');
    expect(markup).toContain('is-draggable');
  });

  it('shows the selected vendor brand logo on each connected provider row', () => {
    const markup = wrap({
      treeHostedView: 'connected',
      providers: [
        { ...provider, id: 'openai-1', name: 'codex', type: 'custom', apiFormat: 'codex-cli', model: 'gpt-5.6-sol' },
        { ...provider, id: 'grok-1', name: 'Grok', type: 'custom', apiFormat: 'grok-cli', model: 'grok-4.6' },
        { ...provider, id: 'cursor-1', name: 'Cursor Ultra', type: 'custom', apiFormat: 'cursor-cli', model: 'cursor-grok-4.6-high' },
      ],
      activeProviderId: 'cursor-1',
      resolveProviderPreset: (item) => {
        if (item.apiFormat === 'grok-cli') return { key: 'grok', label: 'Grok', icon: <span>G</span> };
        if (item.apiFormat === 'cursor-cli') return { key: 'cursor', label: 'Cursor', icon: <span>C</span> };
        return { key: 'openai', label: 'OpenAI', icon: <span>O</span> };
      },
    });
    expect(markup).toContain('/icons/ai/openai.svg');
    expect(markup).toContain('/icons/ai/grok.svg');
    expect(markup).toContain('/icons/ai/cursor.svg');
  });

  it('lays the connected provider page out as a scrolling full-width list', () => {
    expect(providerStyles).toContain('.gonavi-ai-provider-management.is-connected-only {');
    expect(providerStyles).toContain('flex-direction: column');
    expect(providerStyles).toContain('.gonavi-ai-provider-management.is-connected-only .gonavi-ai-provider-chips');
    expect(providerStyles).toContain('.gonavi-ai-provider-management.is-connected-only .gonavi-ai-provider-chip {');
    expect(providerStyles).toContain('width: 100%');
    expect(providerStyles).toContain('.gonavi-ai-provider-connected-title');
    expect(providerStyles).toContain('.gonavi-ai-provider-management.is-connected-only .gonavi-ai-provider-icon {');
    expect(providerStyles).toContain('.gonavi-ai-provider-management.is-connected-only .gonavi-ai-provider-icon .gonavi-ai-provider-logo');
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-management\.is-connected-only \.gonavi-ai-provider-icon \{[^}]*background: transparent;/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-management\.is-connected-only \.gonavi-ai-provider-name \{[^}]*font-size: var\(--gn-settings-font-body, var\(--gn-font-size, 14px\)\);/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-management\.is-connected-only \.gonavi-ai-provider-chip-model \{[^}]*font-size: var\(--gn-settings-font-body, var\(--gn-font-size, 14px\)\);/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-management\.is-connected-only \.gonavi-ai-provider-current \{[^}]*font-size: var\(--gn-settings-font-body, var\(--gn-font-size, 14px\)\);/);
    expect(providerStyles).toMatch(/\.gonavi-ai-provider-management\.is-connected-only \.gonavi-ai-provider-chip-remove \{[^}]*width: var\(--gn-control-height, 32px\);/);
    expect(providerStyles).toContain('.gonavi-ai-provider-chip.is-draggable');
    expect(providerStyles).toContain('.gonavi-ai-provider-chip.is-drag-placeholder');
    expect(providerStyles).toContain('.gonavi-ai-provider-management.is-connected-only .gonavi-ai-provider-toolbar-end');
    expect(providerStyles).toContain('min-width: min(20rem, 100%)');
    expect(providerStyles).toContain('max-width: 32rem');
    expect(providerStyles).toContain('@container connected-providers');
  });

  it('renders the restored vertical editor while retaining the provider dropdown', () => {
    const markup = wrap({ isEditing: true, editingProvider: provider, watchedPresetKey: 'openai', watchedApiFormat: 'openai', onSyncProviderModels: async () => [] });
    const endpointLabelIndex = markup.indexOf('URL');
    const apiKeyLabelIndex = markup.indexOf('API Key');
    expect(markup).not.toContain('Edit model provider');
    expect(markup).toContain('Display name (optional)');
    expect(markup).toContain('Provider');
    expect(markup).toContain('gonavi-ai-provider-preset-select');
    expect(markup.match(/gonavi-ai-provider-preset-select/g)).toHaveLength(1);
    expect(markup).toContain('Custom headers');
    expect(markup).toContain('Default model');
    expect(markup).toContain('Sync upstream');
    expect(markup).toContain('Auto-completion model');
    expect(markup).not.toContain('Favorite chat models');
    expect(markup).not.toContain('Max output tokens');
    expect(markup).not.toContain('Context window');
    expect(markup).toContain('Test connection');
    expect(markup).toContain('Save changes');
    expect(markup).not.toContain('Collapse editor');
    expect(markup).not.toContain('Authentication & connection');
    expect(markup).not.toContain('gonavi-ai-cli-details');
    expect(markup).toContain('gonavi-ai-provider-actions');
    expect(markup).not.toContain('gonavi-ai-provider-hint');
    expect(markup).not.toContain('API Endpoint (URL)');
    expect(markup).toContain('ant-form-vertical');
    expect(markup).not.toContain('gonavi-ai-provider-form-section');
    expect(endpointLabelIndex).toBeGreaterThan(-1);
    expect(apiKeyLabelIndex).toBeGreaterThan(-1);
    expect(endpointLabelIndex).toBeLessThan(apiKeyLabelIndex);
    expect(markup).toContain('gonavi-ai-provider-kv-add');
    expect(markup).not.toContain('gonavi-ai-provider-connection-fields is-inline');
    expect(markup).not.toContain('Connection field layout');
  });

  it('keeps a long test error in the alert and exposes a details entry without dropping Test or Save', () => {
    const trailingReason = 'TLS handshake failed: certificate has expired';
    const message = `${'upstream rejected the request at https://api.example.invalid/v1/chat/completions. '.repeat(3)}${trailingReason}`;
    const markup = wrap({
      isEditing: true,
      editingProvider: provider,
      watchedPresetKey: 'openai',
      watchedApiFormat: 'openai',
      testStatus: 'error',
      testResult: { success: false, checkKind: 'none', modelVerified: false, message },
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-error="true"');
    expect(markup).toContain(trailingReason);
    expect(markup).toContain('View full error');
    expect(markup).toContain('aria-controls="gonavi-ai-provider-test-error-details"');
    expect(markup).toContain('gonavi-ai-provider-test-result-toggle');
    expect(markup).toContain('Test connection');
    expect(markup).toContain('Save changes');
    expect(markup).toContain('gonavi-ai-provider-footer');
    expect(markup).not.toContain('class="gonavi-ai-provider-test-error-details"');
  });

  it('keeps a single API format as a read-only input', () => {
    const markup = wrap({
      isEditing: true,
      editingProvider: provider,
      watchedPresetKey: 'anthropic',
      watchedApiFormat: 'anthropic',
      resolveProviderPreset: () => ({ key: 'anthropic', label: 'Claude', icon: <span>A</span> }),
    });
    expect(markup).toContain('gonavi-ai-provider-fixed-value');
    expect(markup).toContain('Authentication');
  });
});
