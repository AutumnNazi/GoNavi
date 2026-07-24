import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AISettingsSidebar from './AISettingsSidebar';
import { I18nProvider } from '../../i18n/provider';
import { t as catalogTranslate } from '../../i18n/catalog';
import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

const sidebarSource = readFileSync(new URL('./AISettingsSidebar.tsx', import.meta.url), 'utf8');

const REQUIRED_NAV_KEYS = [
  'ai_settings.nav.title',
  'ai_settings.nav.providers.title',
  'ai_settings.nav.providers.description',
  'ai_settings.nav.safety.title',
  'ai_settings.nav.safety.description',
  'ai_settings.nav.context.title',
  'ai_settings.nav.context.description',
  'ai_settings.nav.mcp.title',
  'ai_settings.nav.mcp.description',
  'ai_settings.nav.skills.title',
  'ai_settings.nav.skills.description',
  'ai_settings.nav.tools.title',
  'ai_settings.nav.tools.description',
  'ai_settings.nav.prompts.title',
  'ai_settings.nav.prompts.description',
] as const;

describe('AISettingsSidebar', () => {
  it('renders the ai settings navigation with the active section highlighted', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider preference="en-US" systemLanguages={['en-US']} onPreferenceChange={() => {}}>
        <AISettingsSidebar
          activeSection="mcp"
          darkMode={false}
          overlayTheme={buildOverlayWorkbenchTheme(false)}
          onSelectSection={() => {}}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('Settings navigation');
    expect(markup).toContain('MCP services');
    expect(markup).toContain('Built-in tools');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('id="gonavi-ai-settings-tab-mcp"');
    expect(markup).toContain('role="tab" aria-selected="true" aria-controls="gonavi-ai-settings-panel-mcp" tabindex="0"');
    expect(markup).toContain('aria-selected="false" aria-controls="gonavi-ai-settings-panel-providers" tabindex="-1"');
    expect(markup).not.toContain('aria-pressed=');
    expect(markup).toContain('gonavi-ai-settings-nav-item is-active');
    expect(markup).toContain('border-left:3px solid');
    expect(markup).toContain('border-radius:4px');
    expect(sidebarSource).toContain("style={{ display: 'grid', gap: 2 }}");
    expect(sidebarSource).not.toContain('borderTop');
    expect(sidebarSource).not.toContain('borderBottom');
    expect(markup).not.toContain('linear-gradient(180deg');
  });

  it('supports vertical tab keyboard navigation with a roving tab stop', () => {
    expect(sidebarSource).toContain("['ArrowDown', 'ArrowUp', 'Home', 'End']");
    expect(sidebarSource).toContain('tabIndex={active ? 0 : -1}');
    expect(sidebarSource).toContain('onSelectSection(AI_SETTINGS_NAV_ITEMS[nextIndex].key);');
    expect(sidebarSource).toContain("querySelectorAll<HTMLElement>('[role=\"tab\"]')");
    expect(sidebarSource).toContain('tabs?.[nextIndex]?.focus();');
  });

  it('uses catalog fallback keys for settings navigation chrome', () => {
    expect(sidebarSource).toContain('useOptionalI18n()');
    expect(sidebarSource).toContain("catalogTranslate('en-US'");
    for (const key of REQUIRED_NAV_KEYS) {
      expect(catalogTranslate('en-US', key)).not.toBe(key);
      expect(catalogTranslate('zh-CN', key)).not.toBe(key);
      expect(sidebarSource).toContain(key);
    }

    for (const oldCopy of [
      '模型供应商',
      '配置大模型接口与秘钥',
      '安全控制',
      '限制 AI 操作风险级别',
      '上下文',
      '配置携带的数据架构信息',
      'MCP 服务',
      '把 GoNavi 接入外部客户端并管理工具源',
      '配置可复用提示模块',
      '内置工具',
      '查看 AI 可调用的数据探针',
      '内置提示词',
      '查看系统预设的底层要求',
      '设置导航',
    ]) {
      expect(sidebarSource).not.toContain(oldCopy);
    }
  });
});
