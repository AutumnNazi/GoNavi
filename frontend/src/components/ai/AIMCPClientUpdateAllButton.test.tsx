import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AIMCPClientUpdateAllButton from './AIMCPClientUpdateAllButton';

describe('AIMCPClientUpdateAllButton', () => {
  it('renders a batch update action only when local clients need updating', () => {
    const markup = renderToStaticMarkup(
      <AIMCPClientUpdateAllButton
        statuses={[
          {
            client: 'claude-code',
            displayName: 'Claude Code',
            installMode: 'auto',
            installed: true,
            matchesCurrent: false,
            clientDetected: true,
            clientCommand: 'claude',
            message: 'stale',
          },
          {
            client: 'codex',
            displayName: 'Codex',
            installMode: 'auto',
            installed: true,
            matchesCurrent: false,
            clientDetected: true,
            clientCommand: 'codex',
            message: 'stale',
          },
          {
            client: 'opencode',
            displayName: 'OpenCode',
            installMode: 'auto',
            installed: false,
            matchesCurrent: false,
            clientDetected: false,
            clientCommand: 'opencode',
            message: 'missing',
          },
        ]}
        loading={false}
        onUpdate={() => {}}
      />,
    );

    expect(markup).toContain('Update all that need updating (2)');
    expect(markup).toContain('Updates only locally detected clients whose config does not yet point at this GoNavi.');
  });

  it('hides the batch update action when nothing is stale', () => {
    const markup = renderToStaticMarkup(
      <AIMCPClientUpdateAllButton
        statuses={[
          {
            client: 'claude-code',
            displayName: 'Claude Code',
            installMode: 'auto',
            installed: true,
            matchesCurrent: true,
            clientDetected: true,
            clientCommand: 'claude',
            message: 'connected',
          },
        ]}
        loading={false}
        onUpdate={() => {}}
      />,
    );

    expect(markup).toBe('');
  });
});
