import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AIMCPClientSelectorPanel from './AIMCPClientSelectorPanel';

describe('AIMCPClientSelectorPanel', () => {
  it('renders local install and remote bridge choices with clear state labels', () => {
    const markup = renderToStaticMarkup(
      <AIMCPClientSelectorPanel
        statuses={[
          {
            client: 'codex',
            displayName: 'Codex',
            installed: true,
            matchesCurrent: true,
            clientDetected: true,
            clientCommand: 'codex',
            message: '已检测到 Codex 用户级 GoNavi MCP 配置，且与当前 GoNavi 安装路径一致',
          },
          {
            client: 'openclaw',
            displayName: 'OpenClaw',
            installMode: 'remote',
            installed: false,
            matchesCurrent: false,
            clientDetected: false,
            clientCommand: 'openclaw',
            message: 'OpenClaw 通常部署在云端 Linux；请通过远程 MCP 桥接接入 Windows GoNavi。',
          },
          {
            client: 'opencode',
            displayName: 'OpenCode',
            installMode: 'auto',
            installed: false,
            matchesCurrent: false,
            clientDetected: false,
            clientCommand: 'opencode',
            message: '未检测到 OpenCode 用户级 GoNavi MCP 配置',
          },
        ]}
        selectedClient="openclaw"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        cardBorder="rgba(0,0,0,0.08)"
        statusLoading={false}
        onSelectClient={() => {}}
      />,
    );

    expect(markup).toContain('Connect external client');
    expect(markup).toContain('Select external client');
    expect(markup).toContain('Connection flow and safety notes');
    expect(markup).toContain('Choose target client');
    expect(markup).toContain('Write or copy config');
    expect(markup).toContain('Restart or configure target');
    expect(markup).toContain('Codex');
    expect(markup).toContain('Connected');
    expect(markup).toContain('OpenClaw');
    expect(markup).toContain('Remote bridge');
    expect(markup).toContain('class="gonavi-ai-mcp-client-state"');
    expect(markup).toContain('class="gonavi-ai-mcp-client-state" title="Connected"');
    expect(markup).toContain('>Connected</span>');
    expect(markup).toContain('>Remote bridge</span>');
    expect(markup).toContain('OpenCode');
    expect(markup).toContain('Selected. The remote connection guide will be copied');
    expect(markup).toContain('cloud Agents');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('class="gonavi-ai-mcp-client-option"');
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toContain('border-left:3px solid #1677ff');
    expect(markup).toContain('background:transparent');
    expect(markup).toContain('min-height:46px');
    expect(markup).toContain('class="gonavi-ai-mcp-disclosure gonavi-ai-mcp-client-guide-disclosure"');
    expect(markup).not.toContain('gonavi-ai-mcp-client-guide-disclosure" open');
  });

  it('moves selection and focus with Arrow, Home, and End keys', () => {
    const onSelectClient = vi.fn();
    const statuses = [
      {
        client: 'codex' as const,
        displayName: 'Codex',
        installed: true,
        matchesCurrent: true,
        clientDetected: true,
        clientCommand: 'codex',
        message: 'Connected',
      },
      {
        client: 'openclaw' as const,
        displayName: 'OpenClaw',
        installMode: 'remote' as const,
        installed: false,
        matchesCurrent: false,
        clientDetected: false,
        clientCommand: 'openclaw',
        message: 'Remote',
      },
      {
        client: 'opencode' as const,
        displayName: 'OpenCode',
        installMode: 'auto' as const,
        installed: false,
        matchesCurrent: false,
        clientDetected: false,
        clientCommand: 'opencode',
        message: 'Not connected',
      },
    ];
    const renderer = create(
      <AIMCPClientSelectorPanel
        statuses={statuses}
        selectedClient="openclaw"
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        cardBorder="rgba(0,0,0,0.08)"
        statusLoading={false}
        onSelectClient={onSelectClient}
      />,
    );
    const radios = renderer.root.findAllByProps({ role: 'radio' });
    const focus = radios.map(() => vi.fn());
    const parentElement = {
      querySelectorAll: vi.fn(() => focus.map((focusRadio) => ({ focus: focusRadio }))),
    };
    const press = (radioIndex: number, key: string) => {
      const preventDefault = vi.fn();
      act(() => {
        radios[radioIndex].props.onKeyDown({
          key,
          preventDefault,
          currentTarget: { parentElement },
        });
      });
      expect(preventDefault).toHaveBeenCalledOnce();
    };

    expect(radios.map((radio) => radio.props.tabIndex)).toEqual([-1, 0, -1]);

    press(1, 'ArrowRight');
    expect(onSelectClient).toHaveBeenLastCalledWith('opencode');
    expect(focus[2]).toHaveBeenCalledOnce();

    press(1, 'Home');
    expect(onSelectClient).toHaveBeenLastCalledWith('codex');
    expect(focus[0]).toHaveBeenCalledOnce();

    press(1, 'End');
    expect(onSelectClient).toHaveBeenLastCalledWith('opencode');
    expect(focus[2]).toHaveBeenCalledTimes(2);
  });
});
