import type { AIMCPClientInstallStatus } from '../../types';
import {
  isMCPClientKey,
  listMCPClientsNeedingUpdate,
  type MCPClientKey,
} from '../../utils/mcpClientInstallStatus';
import type { MCPClientInstallCopyParams } from './mcpClientInstallPanelState';

export interface MCPClientInstallService {
  AIInstallClaudeCodeMCP?: () => Promise<unknown>;
  AIInstallCodexMCP?: () => Promise<unknown>;
  AIInstallOpenCodeMCP?: () => Promise<unknown>;
  AIInstallCursorMCP?: () => Promise<unknown>;
  AIInstallZCodeMCP?: () => Promise<unknown>;
  AIInstallDeepSeekHarnessMCP?: () => Promise<unknown>;
  AIInstallKimiMCP?: () => Promise<unknown>;
  AIInstallGrokBuildMCP?: () => Promise<unknown>;
}

type MCPClientCopyFn = (
  key: string,
  fallback: string,
  params?: MCPClientInstallCopyParams,
) => string;

type LocalMCPClientKey = Exclude<MCPClientKey, 'openclaw' | 'hermans'>;

const LOCAL_MCP_INSTALLERS: Record<LocalMCPClientKey, keyof MCPClientInstallService> = {
  'claude-code': 'AIInstallClaudeCodeMCP',
  codex: 'AIInstallCodexMCP',
  opencode: 'AIInstallOpenCodeMCP',
  cursor: 'AIInstallCursorMCP',
  zcode: 'AIInstallZCodeMCP',
  'deepseek-harness': 'AIInstallDeepSeekHarnessMCP',
  kimi: 'AIInstallKimiMCP',
  'grok-build': 'AIInstallGrokBuildMCP',
};

const unsupportedInstallMessage = (
  client: LocalMCPClientKey,
  targetLabel: string,
  copy: MCPClientCopyFn,
): string => {
  if (client === 'opencode') {
    return copy(
      'ai_chat.mcp_client.install.message.opencode_not_supported',
      'This version does not support automatic OpenCode MCP installation yet',
    );
  }
  if (client === 'codex') {
    return copy(
      'ai_chat.mcp_client.install.message.codex_not_supported',
      'This version does not support automatic Codex MCP installation yet',
    );
  }
  if (client === 'claude-code') {
    return copy(
      'ai_chat.mcp_client.install.message.claude_not_supported',
      'This version does not support automatic Claude Code MCP installation yet',
    );
  }
  return copy(
    'ai_chat.mcp_client.install.message.auto_install_not_supported',
    'This version does not support automatic {{label}} MCP installation yet',
    { label: targetLabel },
  );
};

export const resolveLocalMCPClientKey = (client?: string): LocalMCPClientKey | null => {
  const key = String(client || '').trim();
  if (!isMCPClientKey(key) || key === 'openclaw' || key === 'hermans') {
    return null;
  }
  return key;
};

export const installLocalMCPClient = async (
  service: MCPClientInstallService | null | undefined,
  client: MCPClientKey,
  copy: MCPClientCopyFn,
  targetLabel: string,
): Promise<void> => {
  const localClient = resolveLocalMCPClientKey(client);
  if (!localClient) {
    throw new Error(unsupportedInstallMessage('cursor', targetLabel, copy));
  }
  const installer = service?.[LOCAL_MCP_INSTALLERS[localClient]];
  if (typeof installer !== 'function') {
    throw new Error(unsupportedInstallMessage(localClient, targetLabel, copy));
  }
  await installer();
};

export const staleMCPClientLabels = (items?: AIMCPClientInstallStatus[] | null): string[] =>
  listMCPClientsNeedingUpdate(items).map((item) => item.displayName || item.client);

export interface StaleMCPClientUpdateSummary {
  type: 'success' | 'warning' | 'error';
  message: string;
}

export const summarizeStaleMCPClientUpdates = (
  updatedLabels: string[],
  failedLabels: string[],
  copy: MCPClientCopyFn,
): StaleMCPClientUpdateSummary => {
  const updated = updatedLabels.length;
  const failed = failedLabels.length;
  if (updated > 0 && failed === 0) {
    return {
      type: 'success',
      message: copy(
        'ai_chat.mcp_client.install.message.update_all_success',
        'Updated {{count}} clients: {{labels}}',
        { count: updated, labels: updatedLabels.join(', ') },
      ),
    };
  }
  if (updated > 0) {
    return {
      type: 'warning',
      message: copy(
        'ai_chat.mcp_client.install.message.update_all_partial',
        'Updated {{updated}} ({{updatedLabels}}); failed {{failed}} ({{failedLabels}})',
        {
          updated,
          failed,
          updatedLabels: updatedLabels.join(', '),
          failedLabels: failedLabels.join(', '),
        },
      ),
    };
  }
  return {
    type: 'error',
    message: copy(
      'ai_chat.mcp_client.install.message.update_all_failed',
      'Batch update failed: {{failedLabels}}',
      { failedLabels: failedLabels.join(', ') },
    ),
  };
};
