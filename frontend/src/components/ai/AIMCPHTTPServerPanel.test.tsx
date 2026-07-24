import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n/provider';
import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AIMCPHTTPServerPanel from './AIMCPHTTPServerPanel';

vi.mock('../../i18n/runtime', () => ({
  syncLanguageRuntime: vi.fn(async () => undefined),
}));

const source = readFileSync(new URL('./AIMCPHTTPServerPanel.tsx', import.meta.url), 'utf8');
const zhCnCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-CN.json', import.meta.url), 'utf8'));
const zhTwCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-TW.json', import.meta.url), 'utf8'));
const enUsCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/en-US.json', import.meta.url), 'utf8'));
const jaJpCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ja-JP.json', import.meta.url), 'utf8'));
const deDeCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/de-DE.json', import.meta.url), 'utf8'));
const ruRuCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ru-RU.json', import.meta.url), 'utf8'));

const REQUIRED_KEYS = [
  'ai_settings.mcp_http.panel.title',
  'ai_settings.mcp_http.panel.status.running',
  'ai_settings.mcp_http.panel.status.stopped',
  'ai_settings.mcp_http.panel.description',
  'ai_settings.mcp_http.panel.details_summary',
  'ai_settings.mcp_http.panel.retry_start',
  'ai_settings.mcp_http.panel.switch.on',
  'ai_settings.mcp_http.panel.switch.off',
  'ai_settings.mcp_http.panel.addr_label',
  'ai_settings.mcp_http.panel.authorization_placeholder',
  'ai_settings.mcp_http.panel.running_hint',
  'ai_settings.mcp_http.panel.stopped_hint',
  'ai_settings.mcp_http.panel.copy_url',
  'ai_settings.mcp_http.panel.copy_authorization',
  'ai_settings.mcp_http.panel.mode.schema_only',
  'ai_settings.mcp_http.panel.mode.limited_query',
  'ai_settings.mcp_http.panel.limited_query.label',
  'ai_settings.mcp_http.panel.limited_query.hint',
  'ai_settings.mcp_http.panel.limited_query.on',
  'ai_settings.mcp_http.panel.limited_query.off',
];

const buildPanelProps = () => ({
  status: {
    enabled: true,
    running: true,
    addr: '127.0.0.1:8765',
    path: '/mcp',
    url: 'http://127.0.0.1:8765/mcp',
    schemaOnly: false,
    authorizationHeader: 'Bearer gnv_test',
    message: '',
  },
  draft: {
    addr: '127.0.0.1:8765',
    path: '/mcp',
    authorizationHeader: 'Bearer gnv_test',
    schemaOnly: false,
  },
  loading: false,
  cardBg: '#fff',
  cardBorder: 'rgba(0,0,0,0.08)',
  darkMode: false,
  overlayTheme: buildOverlayWorkbenchTheme(false),
  onDraftChange: () => {},
  onToggle: () => {},
  onCopyURL: () => {},
  onCopyAuthorization: () => {},
});

describe('AIMCPHTTPServerPanel', () => {
  it('uses catalog keys instead of hard-coded Chinese panel chrome', () => {
    expect(source).toContain('useOptionalI18n()');
    expect(source).toContain("catalogTranslate('en-US'");
    for (const key of REQUIRED_KEYS) {
      expect(source).toContain(key);
    }
    expect(source).not.toContain('已启动');
    expect(source).not.toContain('未启动');
    expect(source).not.toContain('监听地址 / 端口');
    expect(source).not.toContain('复制 URL');
    expect(source).not.toContain('复制 Authorization');
  });

  it('keeps MCP HTTP panel keys present in all six catalogs', () => {
    for (const key of REQUIRED_KEYS) {
      expect(zhCnCatalog[key]).toBeTruthy();
      expect(zhTwCatalog[key]).toBeTruthy();
      expect(enUsCatalog[key]).toBeTruthy();
      expect(jaJpCatalog[key]).toBeTruthy();
      expect(deDeCatalog[key]).toBeTruthy();
      expect(ruRuCatalog[key]).toBeTruthy();
    }
  });

  it('renders localized panel chrome while preserving URL and Authorization raw values', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider
        preference="en-US"
        systemLanguages={['en-US']}
        onPreferenceChange={() => undefined}
      >
        <AIMCPHTTPServerPanel {...buildPanelProps()} />
      </I18nProvider>,
    );

    expect(markup).toContain('GoNavi MCP HTTP service');
    expect(markup).toContain('Running');
    expect(markup).toContain('Limited query');
    expect(markup).toContain('Listen address / port');
    expect(markup).toContain('Authorization');
    expect(markup).toContain('127.0.0.1:8765');
    expect(markup).toContain('http://127.0.0.1:8765/mcp');
    expect(markup).toContain('Copy Authorization');
    expect(markup).toContain('Bearer gnv_test');
    expect(markup).toContain('Connection settings and permissions');
    expect(markup).toContain('class="gonavi-ai-mcp-disclosure gonavi-ai-mcp-http-disclosure"');
    expect(markup).not.toContain('gonavi-ai-mcp-http-disclosure" open');
  });

  it('falls back to English without an i18n provider', () => {
    const markup = renderToStaticMarkup(
      <AIMCPHTTPServerPanel {...buildPanelProps()} />,
    );

    expect(markup).toContain('GoNavi MCP HTTP service');
    expect(markup).toContain('Running');
    expect(markup).toContain('Copy URL');
  });

  it('keeps Authorization read-only but revealable while running', () => {
    const markup = renderToStaticMarkup(
      <AIMCPHTTPServerPanel {...buildPanelProps()} />,
    );

    expect(markup).toContain('placeholder="Bearer gnv_xxx (leave empty to generate automatically)"');
    expect(markup).toContain('readonly=""');
    expect(markup).not.toContain('placeholder="Bearer gnv_xxx (leave empty to generate automatically)" disabled=""');
  });

  it('binds the switch to persistent enabled intent while keeping runtime status separate', () => {
    expect(source).toContain('const enabled = status?.enabled === true;');
    expect(source).toContain('const running = status?.running === true;');
    expect(source).toContain('checked={enabled}');
    expect(source).not.toContain('checked={running}');
  });

  it('shows the startup failure while the persisted switch remains enabled', () => {
    const markup = renderToStaticMarkup(
      <AIMCPHTTPServerPanel
        {...buildPanelProps()}
        status={{
          ...buildPanelProps().status,
          enabled: true,
          running: false,
          message: 'listen tcp 127.0.0.1:8765: bind: address already in use',
        }}
      />,
    );

    expect(markup).toContain('listen tcp 127.0.0.1:8765: bind: address already in use');
    expect(markup).toContain('Retry start');
  });
});
