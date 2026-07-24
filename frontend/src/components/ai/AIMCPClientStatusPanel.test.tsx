import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildOverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AIMCPClientStatusPanel from './AIMCPClientStatusPanel';

describe('AIMCPClientStatusPanel', () => {
  it('renders selected remote client status, boundary notes, and remote quick-start actions', () => {
    const markup = renderToStaticMarkup(
      <AIMCPClientStatusPanel
        selectedStatus={{
          client: 'hermans',
          displayName: 'Hermans',
          installMode: 'remote',
          installed: false,
          matchesCurrent: false,
          clientDetected: false,
          clientCommand: 'hermans',
          message: 'Hermans 这类远程 Agent 请通过远程 MCP 桥接接入 Windows GoNavi，不要复制数据库密码。',
        }}
        selectedCommandText=""
        darkMode={false}
        overlayTheme={buildOverlayWorkbenchTheme(false)}
        cardBorder="rgba(0,0,0,0.08)"
        statusLoading={false}
        onRefreshStatus={() => {}}
        onCopyConfigPath={() => {}}
        onCopyLaunchCommand={() => {}}
      />,
    );

    expect(markup).toContain('Selected client status');
    expect(markup).toContain('Detection details');
    expect(markup).toContain('Current target client: Hermans');
    expect(markup).toContain('needs a remote MCP bridge to call this GoNavi');
    expect(markup).toContain('Remote connection boundary');
    expect(markup).toContain('--schema-only does not register execute_sql by default');
    expect(markup).toContain('Hermans Remote MCP quick setup');
    expect(markup).toContain('Configure in cloud Agent');
    expect(markup).toContain('CLI detection: Remote Agent does not need local hermans command detection');
    expect(markup).toContain('Hermans 这类远程 Agent 请通过远程 MCP 桥接接入 Windows GoNavi，不要复制数据库密码。');
    expect(markup).toContain('Refresh status');
    expect(markup).toContain('Copy config path');
    expect(markup).toContain('Copy launch command');
    expect(markup).toContain('class="gonavi-ai-mcp-client-status-panel"');
    expect(markup).toContain('class="gonavi-ai-mcp-disclosure gonavi-ai-mcp-client-status-disclosure"');
    expect(markup).not.toContain('gonavi-ai-mcp-client-status-disclosure" open');
  });
});
