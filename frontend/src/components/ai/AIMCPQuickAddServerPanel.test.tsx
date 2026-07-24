import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { t as translateCatalog } from '../../i18n/catalog';
import { I18nProvider } from '../../i18n/provider';
import AIMCPQuickAddServerPanel from './AIMCPQuickAddServerPanel';

vi.mock('antd', async () => {
  const React = await import('react');
  return {
    Input: {
      TextArea: ({ autoSize: _autoSize, ...props }: any) => React.createElement('textarea', props),
    },
    Button: ({ icon, children, ...props }: any) => React.createElement('button', props, icon, children),
  };
});

vi.mock('@ant-design/icons', async () => {
  const React = await import('react');
  return {
    PlusOutlined: () => React.createElement('span', { 'data-testid': 'plus-icon' }),
  };
});

const buildQuickAddPanel = (onAddServer = () => {}) => (
  <AIMCPQuickAddServerPanel
    cardBg="#fff"
    cardBorder="rgba(0,0,0,0.08)"
    inputBg="#fff"
    darkMode={false}
    overlayTheme={buildOverlayWorkbenchTheme(false)}
    onAddServer={onAddServer}
  />
);

const buildLocalizedQuickAddPanel = (language: 'en-US' | 'zh-CN') => (
  <I18nProvider preference={language} onPreferenceChange={() => {}}>
    {buildQuickAddPanel()}
  </I18nProvider>
);

const flattenRendererText = (node: any): string => {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => flattenRendererText(item)).join('');
  }
  return flattenRendererText(node.children ?? node.props?.children);
};

const findTemplateButton = (renderer: ReactTestRenderer, label: string) => {
  const matches = renderer.root.findAll(
    (node) => node.type === 'button' && flattenRendererText(node).includes(label),
  );
  expect(matches.length).toBe(1);
  return matches[0];
};

describe('AIMCPQuickAddServerPanel', () => {
  it('renders a top-level full-command entry for creating MCP drafts', () => {
    const zh = (key: string, params?: Record<string, string | number>) =>
      translateCatalog('zh-CN', key, params);
    const markup = renderToStaticMarkup(
      buildLocalizedQuickAddPanel('zh-CN'),
    );

    expect(markup).toContain(zh('ai_settings.mcp_server.quick_add.title'));
    expect(markup).toContain(zh('ai_settings.mcp_server.quick_add.description'));
    expect(markup).toContain(zh('ai_settings.mcp_server.quick_add.templates_title'));
    expect(markup).toContain(zh('ai_settings.mcp_server.template.npx.title'));
    expect(markup).toContain('npx -y @modelcontextprotocol/server-filesystem --stdio');
    expect(markup).toContain(zh('ai_settings.mcp_server.template.docker.title'));
    expect(markup).toContain('docker run --rm -i mcp/server-fetch:latest');
    expect(markup).toContain(zh('ai_settings.mcp_server.guide.full_command.placeholder', {
      example: '',
    }).trim());
    expect(markup).toContain('$env:GITHUB_TOKEN=...; uvx mcp-server-github --stdio');
    expect(markup).toContain(zh('ai_settings.mcp_server.quick_add.action.parse_and_add'));
    expect(markup).toContain('class="gonavi-ai-mcp-disclosure gonavi-ai-mcp-template-disclosure"');
    expect(markup).not.toContain('gonavi-ai-mcp-template-disclosure" open');
    expect(markup).toContain(zh('ai_settings.mcp_server.section.action.add_server'));
  });

  it('renders quick-add copy from the active locale', () => {
    const markup = renderToStaticMarkup(
      buildLocalizedQuickAddPanel('en-US'),
    );

    expect(markup).toContain('Quick add from one command');
    expect(markup).toContain('Common startup templates');
    expect(markup).toContain('Paste the full command, for example:');
    expect(markup).toContain('Parse and add draft');
    expect(markup).not.toContain(translateCatalog('zh-CN', 'ai_settings.mcp_server.quick_add.title'));
    expect(markup).not.toContain(translateCatalog('zh-CN', 'ai_settings.mcp_server.quick_add.templates_title'));
    expect(markup).not.toContain(translateCatalog('zh-CN', 'ai_settings.mcp_server.quick_add.action.parse_and_add'));
  });

  it('seeds a new npx MCP draft from the quick-add template', async () => {
    const onAddServer = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(buildQuickAddPanel(onAddServer));
    });

    findTemplateButton(renderer, 'npx package').props.onClick();

    expect(onAddServer).toHaveBeenCalledWith(expect.objectContaining({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '--stdio'],
    }));
  });

  it('seeds a docker MCP draft from the quick-add template', async () => {
    const onAddServer = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(buildQuickAddPanel(onAddServer));
    });

    findTemplateButton(renderer, 'Docker image').props.onClick();

    expect(onAddServer).toHaveBeenCalledWith(expect.objectContaining({
      command: 'docker',
      args: ['run', '--rm', '-i', 'mcp/server-fetch:latest'],
      timeoutSeconds: 45,
    }));
  });
});
