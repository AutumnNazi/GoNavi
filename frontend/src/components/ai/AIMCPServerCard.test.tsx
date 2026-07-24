import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AIMCPServerCard from './AIMCPServerCard';
import { I18nProvider } from '../../i18n/provider';
import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

describe('AIMCPServerCard', () => {
  it('renders explicit MCP parameter hints, required badges, and the actual launch preview for command, args, and env', () => {
    const markup = renderToStaticMarkup(
      <AIMCPServerCard
        server={{
          id: 'mcp-1',
          name: '',
          transport: 'stdio',
          command: 'node',
          args: ['server.js', '--stdio'],
          env: {},
          enabled: true,
          timeoutSeconds: 20,
        }}
        serverTools={[]}
        cardBg="#fff"
        cardBorder="rgba(0,0,0,0.08)"
        inputBg="#fff"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        loading={false}
        onChange={() => {}}
        onTest={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(markup).toContain('Put only the executable itself in the startup command');
    expect(markup).toContain('Recommended fill order');
    expect(markup).toContain('New users can follow this order');
    expect(markup).toContain('Field quick reference');
    expect(markup).toContain('The name shown to you and the AI after saving');
    expect(markup).toContain('Example:');
    expect(markup).toContain('Filesystem / Browser / GitHub');
    expect(markup).toContain('-y / @modelcontextprotocol/server-filesystem / --stdio / server.js');
    expect(markup).toContain('Currently fixed to stdio');
    expect(markup).toContain('Maximum wait time for one tool discovery or call');
    expect(markup).toContain('Required');
    expect(markup).toContain('Optional');
    expect(markup).toContain('Fixed');
    expect(markup).toContain('Paste the full command directly');
    expect(markup).toContain('Auto-split into the fields below');
    expect(markup).toContain('$env:KEY=VALUE;');
    expect(markup).toContain('set KEY=VALUE &amp;&amp;');
    expect(markup).toContain('npx -y package --stdio');
    expect(markup).toContain('-y / @modelcontextprotocol/server-filesystem / --stdio / server.js');
    expect(markup).toContain('Enter each argument as a separate tag');
    expect(markup).toContain('Current command node argument hints');
    expect(markup).toContain('Node script argument order');
    expect(markup).toContain('Recommended order: script path -&gt; --stdio -&gt; service business arguments');
    expect(markup).toContain('Required arguments look complete');
    expect(markup).toContain('Use one KEY=VALUE per line');
    expect(markup).toContain('lines without an equals sign or with spaces in the key will not be saved');
    expect(markup).toContain('Do not paste the whole npx -y package --stdio');
    expect(markup).toContain('do not write export');
    expect(markup).toContain('Only stdio is supported for now');
    expect(markup).toContain('Actual launch command preview');
    expect(markup).toContain('Configuration check');
    expect(markup).toContain('Service name is empty');
    expect(markup).toContain('Check recommended');
    expect(markup).toContain('Action guide');
    expect(markup).toContain('Test tool discovery');
    expect(markup).toContain('does not save the configuration');
    expect(markup).toContain('the tools discovered from this service will appear above');
    expect(markup).toContain('Default 20 seconds');
    expect(markup).toContain('Relaxed 45 seconds');
    expect(markup).toContain('Slow start 60 seconds');
    expect(markup).toContain('npx -y @modelcontextprotocol/server-filesystem --stdio');
    expect(markup).toContain('node server.js --stdio');
    expect(markup).toContain('$env:GITHUB_TOKEN=...; uvx mcp-server-github --stdio');
  });

  it('keeps saved services compact while opening a new draft for editing', () => {
    const renderCard = (id: string) => renderToStaticMarkup(
      <AIMCPServerCard
        server={{
          id,
          name: '',
          transport: 'stdio',
          command: 'node',
          args: ['server.js', '--stdio'],
          env: {},
          enabled: true,
          timeoutSeconds: 20,
        }}
        serverTools={[]}
        cardBg="#fff"
        cardBorder="rgba(0,0,0,0.08)"
        inputBg="#fff"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        loading={false}
        onChange={() => {}}
        onTest={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    const savedMarkup = renderCard('mcp-saved');
    const draftMarkup = renderCard('mcp-draft-123');

    expect(savedMarkup).toContain('Unnamed MCP service');
    expect(savedMarkup).toContain('class="gonavi-ai-mcp-server-row gonavi-ai-mcp-disclosure"');
    expect(savedMarkup).not.toContain('gonavi-ai-mcp-server-row gonavi-ai-mcp-disclosure" open');
    expect(draftMarkup).toContain('gonavi-ai-mcp-server-row gonavi-ai-mcp-disclosure" open=""');
    expect(savedMarkup).toContain('Recommended fill order');
  });

  it('does not expose a malformed full command in the collapsed summary', () => {
    const secret = 'summary-secret-value';
    const markup = renderToStaticMarkup(
      <AIMCPServerCard
        server={{
          id: 'mcp-saved',
          name: 'Private MCP',
          transport: 'stdio',
          command: `$env:GITHUB_TOKEN=${secret}; uvx mcp-server-github --stdio`,
          args: [],
          env: {},
          enabled: true,
          timeoutSeconds: 20,
        }}
        serverTools={[]}
        cardBg="#fff"
        cardBorder="rgba(0,0,0,0.08)"
        inputBg="#fff"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        loading={false}
        onChange={() => {}}
        onTest={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    const summaryMarkup = markup.match(/<summary>[\s\S]*?<\/summary>/u)?.[0] || '';
    expect(summaryMarkup).toContain('Private MCP');
    expect(summaryMarkup).not.toContain(secret);
  });

  it('renders the MCP setup guide in Chinese when an i18n provider is available', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider preference="zh-CN" systemLanguages={['zh-CN']} onPreferenceChange={() => {}}>
        <AIMCPServerCard
          server={{
            id: 'mcp-1',
            name: '',
            transport: 'stdio',
            command: 'node',
            args: ['server.js', '--stdio'],
            env: {},
            enabled: true,
            timeoutSeconds: 20,
          }}
          serverTools={[]}
          cardBg="#fff"
          cardBorder="rgba(0,0,0,0.08)"
          inputBg="#fff"
          darkMode={false}
          overlayTheme={buildOverlayWorkbenchTheme(false)}
          loading={false}
          onChange={() => {}}
          onTest={() => {}}
          onSave={() => {}}
          onDelete={() => {}}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('推荐填写顺序');
    expect(markup).toContain('字段速查');
    expect(markup).toContain('保存后显示给你和 AI 看的名字');
    expect(markup).toContain('示例值：');
    expect(markup).toContain('服务名称为空');
    expect(markup).toContain('npx -y @modelcontextprotocol/server-filesystem --stdio');
  });

  it('renders actionable validation when command and args are mixed together', () => {
    const markup = renderToStaticMarkup(
      <AIMCPServerCard
        server={{
          id: 'mcp-1',
          name: 'Node MCP',
          transport: 'stdio',
          command: 'node server.js --stdio',
          args: [],
          env: {},
          enabled: true,
          timeoutSeconds: 20,
        }}
        serverTools={[]}
        cardBg="#fff"
        cardBorder="rgba(0,0,0,0.08)"
        inputBg="#fff"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        loading={false}
        onChange={() => {}}
        onTest={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(markup).toContain('Startup command may contain the whole command line');
    expect(markup).toContain('Move the script name, module name, --stdio, and environment variables into arguments or environment variables');
    expect(markup).toContain('Command arguments may be missing the script or module name');
  });

  it('renders env key purpose hints without requiring users to guess common MCP variables', () => {
    const markup = renderToStaticMarkup(
      <AIMCPServerCard
        server={{
          id: 'mcp-2',
          name: 'GitHub MCP',
          transport: 'stdio',
          command: 'uvx',
          args: ['mcp-server-github', '--stdio'],
          env: {
            GITHUB_TOKEN: '...',
            HTTPS_PROXY: 'http://127.0.0.1:7890',
          },
          enabled: true,
          timeoutSeconds: 20,
        }}
        serverTools={[]}
        cardBg="#fff"
        cardBorder="rgba(0,0,0,0.08)"
        inputBg="#fff"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        loading={false}
        onChange={() => {}}
        onTest={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(markup).toContain('Environment variable usage hints');
    expect(markup).toContain('Only the key purpose and risk are explained here; values are not shown');
    expect(markup).toContain('GITHUB_TOKEN');
    expect(markup).toContain('GitHub Token');
    expect(markup).toContain('HTTPS_PROXY');
    expect(markup).toContain('HTTPS proxy');
    expect(markup).toContain('Current value looks like an example placeholder');
    expect(markup).toContain('Secret-like variables are stored only in local configuration');
  });
});
