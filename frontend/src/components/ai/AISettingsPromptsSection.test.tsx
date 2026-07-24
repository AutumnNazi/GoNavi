import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AISettingsPromptsSection from './AISettingsPromptsSection';
import { I18nProvider } from '../../i18n/provider';
import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

vi.mock('../../i18n/runtime', () => ({
  syncLanguageRuntime: vi.fn(async () => undefined),
}));

const source = readFileSync(new URL('./AISettingsPromptsSection.tsx', import.meta.url), 'utf8');
const zhCnCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-CN.json', import.meta.url), 'utf8'));
const zhTwCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-TW.json', import.meta.url), 'utf8'));
const enUsCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/en-US.json', import.meta.url), 'utf8'));
const jaJpCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ja-JP.json', import.meta.url), 'utf8'));
const deDeCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/de-DE.json', import.meta.url), 'utf8'));
const ruRuCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ru-RU.json', import.meta.url), 'utf8'));

const renderPromptsSection = (language: 'zh-CN' | 'en-US') => renderToStaticMarkup(
  <I18nProvider
    preference={language}
    systemLanguages={[language]}
    onPreferenceChange={() => undefined}
  >
    <AISettingsPromptsSection
      builtinPrompts={{ 数据库: '生成 SQL 前必须先确认字段名。' }}
      userPromptSettings={{
        global: '',
        database: '',
        jvm: '',
        jvmDiagnostic: '',
      }}
      overlayTheme={buildOverlayWorkbenchTheme(false)}
      cardBg="#fff"
      cardBorder="rgba(0,0,0,0.08)"
      inputBg="#fff"
      darkMode={false}
      loading={false}
      onChangeUserPrompt={() => {}}
      onSave={() => {}}
    />
  </I18nProvider>
);

describe('AISettingsPromptsSection', () => {
  it('renders editable user prompts and readonly builtin prompt blocks after extraction', () => {
    const markup = renderPromptsSection('zh-CN');

    expect(markup).toContain('用户级自定义提示词');
    expect(markup).toContain('全局补充提示词');
    expect(markup).toContain('保存自定义提示词');
    expect(markup).toContain('数据库');
    expect(markup).toContain('生成 SQL 前必须先确认字段名');
  });

  it('renders user prompt chrome from the active locale while preserving builtin prompt raw text', () => {
    const markup = renderPromptsSection('en-US');

    expect(markup).toContain('User-level custom prompts');
    expect(markup).toContain('Global extra prompt');
    expect(markup).toContain('Save custom prompts');
    expect(markup).toContain('Leave empty to add nothing extra');
    expect(markup).toContain('数据库');
    expect(markup).toContain('生成 SQL 前必须先确认字段名');
    expect(markup).not.toContain('用户级自定义提示词');
    expect(markup).not.toContain('保存自定义提示词');
  });

  it('uses spaced flat sections without horizontal dividers', () => {
    const markup = renderPromptsSection('en-US');

    expect(markup).toContain('gonavi-ai-user-prompts-editor');
    expect(markup).toContain('gonavi-ai-builtin-prompt');
    expect(markup).not.toContain('border-bottom:1px solid rgba(0,0,0,0.08)');
    expect(markup).not.toContain('border-top:1px solid rgba(0,0,0,0.08)');
    expect(markup).toContain('border-left:2px solid rgba(0,0,0,0.08)');
    expect(source).toContain('gap: 2');
    expect(source).toContain('borderRadius: 4');
    expect(source).not.toContain('background: cardBg');
    expect(source).not.toContain('borderRadius: 14');
    expect(source).not.toContain('borderRadius: 12');
    expect(source).toContain("fontSize: 'var(--gn-font-size, 14px)'");
    expect(source).toContain("fontSize: 'var(--gn-settings-font-secondary, 13px)'");
    expect(source).toContain("fontSize: 'var(--gn-font-size-sm, 12px)'");
  });

  it('uses native disclosures and keeps collapsed prompt content mounted', () => {
    const markup = renderPromptsSection('zh-CN');

    expect(markup).toContain('<details class="gonavi-ai-settings-disclosure gonavi-ai-user-prompt"');
    expect(markup).toContain('<details class="gonavi-ai-settings-disclosure gonavi-ai-builtin-prompt"');
    expect(markup).toContain('<summary');
    expect(markup).toContain('gonavi-ai-settings-disclosure-content');
    expect(markup).toContain('gonavi-ai-settings-disclosure-icon');
    expect(source).toContain("padding: '0 2px 14px'");
    expect(source).toContain("margin: '0 2px 14px'");
    expect(source).not.toContain("14px 26px");
    expect(markup).toContain('生成 SQL 前必须先确认字段名');
    expect(markup).toContain('aria-label="全局补充提示词"');
  });

  it('keeps user prompt chrome keys present in all six catalogs', () => {
    const requiredKeys = [
      'ai_settings.prompts.user.title',
      'ai_settings.prompts.user.description',
      'ai_settings.prompts.field.global.title',
      'ai_settings.prompts.field.global.description',
      'ai_settings.prompts.field.database.title',
      'ai_settings.prompts.field.database.description',
      'ai_settings.prompts.field.jvm.title',
      'ai_settings.prompts.field.jvm.description',
      'ai_settings.prompts.field.jvm_diagnostic.title',
      'ai_settings.prompts.field.jvm_diagnostic.description',
      'ai_settings.prompts.placeholder.empty',
      'ai_settings.prompts.action.save',
      'ai_settings.prompts.builtin.description',
    ];

    for (const key of requiredKeys) {
      expect(zhCnCatalog[key]).toBeTruthy();
      expect(zhTwCatalog[key]).toBeTruthy();
      expect(enUsCatalog[key]).toBeTruthy();
      expect(jaJpCatalog[key]).toBeTruthy();
      expect(deDeCatalog[key]).toBeTruthy();
      expect(ruRuCatalog[key]).toBeTruthy();
    }
  });

  it('uses i18n keys instead of legacy Chinese prompt settings literals', () => {
    expect(source).toContain('useOptionalI18n()');
    expect(source).toContain("catalogTranslate('en-US', key, params)");
    expect(source).toContain('ai_settings.prompts.user.title');
    expect(source).toContain('ai_settings.prompts.action.save');
    expect(source).not.toContain('用户级自定义提示词');
    expect(source).not.toContain('保存自定义提示词');
    expect(source).not.toContain('留空表示不额外追加');
  });
});
