import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AIMCPClientInstallStatus, AIMCPHTTPServerStatus, AIMCPServerConfig, AIMCPToolDescriptor } from '../../types';
import type { MCPClientKey } from '../../utils/mcpClientInstallStatus';
import { MCP_FIELD_GUIDES } from '../../utils/mcpServerGuidance';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import AIMCPClientInstallPanel from './AIMCPClientInstallPanel';
import AIMCPFieldGuideCard from './AIMCPFieldGuideCard';
import AIMCPHTTPServerPanel from './AIMCPHTTPServerPanel';
import type { AIMCPHTTPServerDraft } from './AIMCPHTTPServerPanel';
import AIMCPQuickAddServerPanel from './AIMCPQuickAddServerPanel';
import AIMCPServerCard from './AIMCPServerCard';

export type { MCPClientKey } from '../../utils/mcpClientInstallStatus';

export interface AISettingsMCPSectionProps {
  mcpClientStatuses: AIMCPClientInstallStatus[];
  selectedMCPClient: MCPClientKey;
  selectedMCPClientStatus?: AIMCPClientInstallStatus;
  selectedMCPClientCommandText: string;
  mcpHTTPServerStatus: AIMCPHTTPServerStatus;
  mcpHTTPServerDraft: AIMCPHTTPServerDraft;
  mcpServers: AIMCPServerConfig[];
  mcpTools: AIMCPToolDescriptor[];
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  loading: boolean;
  mcpClientStatusLoading: boolean;
  mcpHTTPServerLoading: boolean;
  onUpdateHTTPServerDraft: (patch: Partial<AIMCPHTTPServerDraft>) => void;
  onToggleHTTPServer: (checked: boolean) => void;
  onCopyHTTPServerURL: () => void;
  onCopyHTTPServerAuthorization: () => void;
  onSelectClient: (client: MCPClientKey) => void;
  onRefreshStatus: () => void;
  onCopyConfigPath: () => void;
  onCopyLaunchCommand: () => void;
  onInstallSelectedClient: () => void;
  onAddServer: (seed?: Partial<AIMCPServerConfig>) => void;
  onUpdateServerDraft: (id: string, patch: Partial<AIMCPServerConfig>) => void;
  onTestServer: (server: AIMCPServerConfig) => void;
  onSaveServer: (server: AIMCPServerConfig) => void;
  onDeleteServer: (id: string) => void;
}

const AISettingsMCPSection: React.FC<AISettingsMCPSectionProps> = ({
  mcpClientStatuses,
  selectedMCPClient,
  selectedMCPClientStatus,
  selectedMCPClientCommandText,
  mcpHTTPServerStatus,
  mcpHTTPServerDraft,
  mcpServers,
  mcpTools,
  darkMode,
  overlayTheme,
  cardBg,
  cardBorder,
  inputBg,
  loading,
  mcpClientStatusLoading,
  mcpHTTPServerLoading,
  onUpdateHTTPServerDraft,
  onToggleHTTPServer,
  onCopyHTTPServerURL,
  onCopyHTTPServerAuthorization,
  onSelectClient,
  onRefreshStatus,
  onCopyConfigPath,
  onCopyLaunchCommand,
  onInstallSelectedClient,
  onAddServer,
  onUpdateServerDraft,
  onTestServer,
  onSaveServer,
  onDeleteServer,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);
  const [activeView, setActiveView] = React.useState<'external-clients' | 'tool-sources'>('external-clients');
  const tabs = [
    {
      key: 'external-clients' as const,
      source: copy('ai_settings.mcp_section.tab.external_clients'),
      target: 'GoNavi',
    },
    {
      key: 'tool-sources' as const,
      source: 'GoNavi',
      target: copy('ai_settings.mcp_section.tab.tool_sources'),
    },
  ];

  return (
    <div
      className="gonavi-ai-mcp-section"
      style={{
        display: 'flex',
        flexDirection: 'column',
        '--gn-mcp-accent': overlayTheme.selectedText,
        '--gn-mcp-accent-bg': overlayTheme.selectedBg,
      } as React.CSSProperties}
    >
      <div
        className="gonavi-ai-mcp-tabs"
        role="tablist"
        aria-label={copy('ai_settings.nav.mcp.title')}
      >
        {tabs.map((tab, tabIndex) => {
          const active = activeView === tab.key;
          return (
            <button
              key={tab.key}
              id={`gonavi-ai-mcp-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-label={`${tab.source} → ${tab.target}`}
              aria-selected={active}
              aria-controls={`gonavi-ai-mcp-panel-${tab.key}`}
              tabIndex={active ? 0 : -1}
              className={`gonavi-ai-mcp-tab${active ? ' is-active' : ''}`}
              onClick={() => setActiveView(tab.key)}
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
                  return;
                }
                event.preventDefault();
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : event.key === 'ArrowRight'
                      ? (tabIndex + 1) % tabs.length
                      : (tabIndex - 1 + tabs.length) % tabs.length;
                setActiveView(tabs[nextIndex].key);
                const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
                tabButtons?.[nextIndex]?.focus();
              }}
              style={{
                color: active ? overlayTheme.selectedText : overlayTheme.mutedText,
              }}
            >
              <span>{tab.source}</span>
              <span className="gonavi-ai-mcp-route-arrow" aria-hidden>→</span>
              <span>{tab.target}</span>
            </button>
          );
        })}
      </div>

      <div
        id="gonavi-ai-mcp-panel-external-clients"
        role="tabpanel"
        aria-labelledby="gonavi-ai-mcp-tab-external-clients"
        hidden={activeView !== 'external-clients'}
        className="gonavi-ai-mcp-panel"
        style={{ display: activeView === 'external-clients' ? 'flex' : 'none' }}
      >
        <AIMCPHTTPServerPanel
          status={mcpHTTPServerStatus}
          draft={mcpHTTPServerDraft}
          loading={mcpHTTPServerLoading}
          cardBg={cardBg}
          cardBorder={cardBorder}
          darkMode={darkMode}
          overlayTheme={overlayTheme}
          onDraftChange={onUpdateHTTPServerDraft}
          onToggle={onToggleHTTPServer}
          onCopyURL={onCopyHTTPServerURL}
          onCopyAuthorization={onCopyHTTPServerAuthorization}
        />
        <AIMCPClientInstallPanel
          statuses={mcpClientStatuses}
          selectedClient={selectedMCPClient}
          selectedStatus={selectedMCPClientStatus}
          selectedCommandText={selectedMCPClientCommandText}
          darkMode={darkMode}
          overlayTheme={overlayTheme}
          cardBg={cardBg}
          cardBorder={cardBorder}
          loading={loading}
          statusLoading={mcpClientStatusLoading}
          onSelectClient={onSelectClient}
          onRefreshStatus={onRefreshStatus}
          onCopyConfigPath={onCopyConfigPath}
          onCopyLaunchCommand={onCopyLaunchCommand}
          onInstall={onInstallSelectedClient}
        />
      </div>

      <div
        id="gonavi-ai-mcp-panel-tool-sources"
        role="tabpanel"
        aria-labelledby="gonavi-ai-mcp-tab-tool-sources"
        hidden={activeView !== 'tool-sources'}
        className="gonavi-ai-mcp-panel"
        style={{ display: activeView === 'tool-sources' ? 'flex' : 'none' }}
      >
        <details className="gonavi-ai-mcp-disclosure gonavi-ai-mcp-quick-add-disclosure">
          <summary>
            <span style={{ fontWeight: 700, color: overlayTheme.titleText }}>
              {copy('ai_settings.mcp_server.quick_add.title')}
            </span>
            <span className="gonavi-ai-mcp-summary-note" style={{ color: overlayTheme.mutedText }}>
              {copy('ai_settings.mcp_server.quick_add.description')}
            </span>
          </summary>
          <AIMCPQuickAddServerPanel
            cardBg={cardBg}
            cardBorder={cardBorder}
            inputBg={inputBg}
            darkMode={darkMode}
            overlayTheme={overlayTheme}
            hideHeading
            onAddServer={onAddServer}
          />
        </details>

        {mcpServers.length === 0 && (
          <div
            title={copy('ai_settings.mcp_server.section.empty')}
            style={{ padding: '13px 2px', borderRadius: 4, background: 'transparent', color: overlayTheme.mutedText, fontSize: 12 }}
          >
            {copy('ai_settings.mcp_server.section.empty_compact')}
          </div>
        )}
        {mcpServers.map((server) => (
          <AIMCPServerCard
            key={server.id}
            server={server}
            serverTools={mcpTools.filter((tool) => tool.serverId === server.id)}
            cardBg={cardBg}
            cardBorder={cardBorder}
            inputBg={inputBg}
            darkMode={darkMode}
            overlayTheme={overlayTheme}
            loading={loading}
            onChange={(patch) => onUpdateServerDraft(server.id, patch)}
            onTest={() => onTestServer(server)}
            onSave={() => onSaveServer(server)}
            onDelete={() => onDeleteServer(server.id)}
          />
        ))}

        <details className="gonavi-ai-mcp-disclosure gonavi-ai-mcp-reference-disclosure">
          <summary>
            <span style={{ fontWeight: 700, color: overlayTheme.titleText }}>
              {copy('ai_settings.mcp_server.section.quick_reference.title')}
            </span>
            <span className="gonavi-ai-mcp-summary-note" style={{ color: overlayTheme.mutedText }}>
              {copy('ai_settings.mcp_server.section.quick_reference.description')}
            </span>
          </summary>
          <div
            style={{
              padding: '4px 0 16px',
              background: 'transparent',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              {MCP_FIELD_GUIDES.filter((item) => ['command', 'args', 'env', 'timeout'].includes(item.key)).map((item) => (
                <AIMCPFieldGuideCard
                  key={item.key}
                  item={item}
                  cardBorder={cardBorder}
                  darkMode={darkMode}
                  overlayTheme={overlayTheme}
                  compact
                />
              ))}
            </div>
            <div style={{ fontSize: 12, color: overlayTheme.mutedText }}>
              {copy('ai_settings.mcp_server.section.quick_reference.footer')}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default AISettingsMCPSection;
