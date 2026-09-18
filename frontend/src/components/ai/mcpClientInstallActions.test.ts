import { describe, expect, it, vi } from 'vitest';

import {
  installLocalMCPClient,
  staleMCPClientLabels,
  summarizeStaleMCPClientUpdates,
} from './mcpClientInstallActions';

const copy = (
  key: string,
  fallback: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) => fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params?.[name] ?? ''));

describe('mcpClientInstallActions', () => {
  it('routes local auto-install clients to their dedicated installer', async () => {
    const service = {
      AIInstallClaudeCodeMCP: vi.fn(async () => ({})),
      AIInstallCursorMCP: vi.fn(async () => ({})),
    };

    await installLocalMCPClient(service, 'cursor', copy, 'Cursor');

    expect(service.AIInstallCursorMCP).toHaveBeenCalledTimes(1);
    expect(service.AIInstallClaudeCodeMCP).not.toHaveBeenCalled();
  });

  it('keeps the OpenCode-specific unsupported message when the binding is missing', async () => {
    await expect(installLocalMCPClient({}, 'opencode', copy, 'OpenCode')).rejects.toThrow(
      'This version does not support automatic OpenCode MCP installation yet',
    );
  });

  it('summarizes mixed batch updates and lists only stale local clients', () => {
    expect(staleMCPClientLabels([
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
        client: 'openclaw',
        displayName: 'OpenClaw',
        installMode: 'remote',
        installed: true,
        matchesCurrent: false,
        clientDetected: false,
        clientCommand: 'openclaw',
        message: 'remote',
      },
    ])).toEqual(['Codex']);

    expect(summarizeStaleMCPClientUpdates(['Claude Code', 'Codex'], [], copy)).toEqual({
      type: 'success',
      message: 'Updated 2 clients: Claude Code, Codex',
    });
    expect(summarizeStaleMCPClientUpdates(['Codex'], ['Cursor'], copy)).toEqual({
      type: 'warning',
      message: 'Updated 1 (Codex); failed 1 (Cursor)',
    });
    expect(summarizeStaleMCPClientUpdates([], ['Cursor'], copy)).toEqual({
      type: 'error',
      message: 'Batch update failed: Cursor',
    });
  });
});
