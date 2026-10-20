
import SettingsCenterTreeNav, { findSettingsCenterTreeItem } from '../../components/settings/SettingsCenterTreeNav';
import { isToolCenterGroupKey } from '../settingsCenterPanes';
import { SettingsCenterWorkbenchRegistrar } from '../../components/settings/SettingsCenterWorkbenchBridge';
import type { useAppCoreState } from '../hooks/useAppCoreState';
import type { useAppSettingsNavigation } from '../hooks/useAppSettingsNavigation';
import type { useAppShellState } from '../hooks/useAppShellState';
import type { useAppSecurityUpdate } from '../hooks/useAppSecurityUpdate';
import type { useAppSettingsCenterRender } from '../hooks/useAppSettingsCenterRender';
import type { useAppProxySettings } from '../hooks/useAppProxySettings';
import type { useAppDirectorySettingsRender } from '../hooks/useAppDirectorySettingsRender';
import type { useAppBootstrapEffects } from '../hooks/useAppBootstrapEffects';
import type { useAppUpdateAndDiagnostics } from '../hooks/useAppUpdateAndDiagnostics';
import type { useAppAboutSettingsRender } from '../hooks/useAppAboutSettingsRender';
import { createToolCenterPaneRenderer } from './toolCenterPaneRenderer';
import { buildToolCenterGroups } from './toolCenterGroups';

export interface RenderAppSettingsCenterModalInput {
  t: ReturnType<typeof useAppCoreState>['t'];
  handleOpenToolCenterPane: ReturnType<typeof useAppSettingsNavigation>['handleOpenToolCenterPane'];
  securityUpdateEntryVisibility: ReturnType<typeof useAppShellState>['securityUpdateEntryVisibility'];
  securityUpdateHasLegacySensitiveItems: ReturnType<typeof useAppShellState>['securityUpdateHasLegacySensitiveItems'];
  securityUpdateStatusMeta: ReturnType<typeof useAppShellState>['securityUpdateStatusMeta'];
  handleCancelSettingsCenterPane: ReturnType<typeof useAppSettingsNavigation>['handleCancelSettingsCenterPane'];
  settingsCenterGroups: ReturnType<typeof useAppSettingsCenterRender>['settingsCenterGroups'];
  activeSettingsCenterGroupKey: ReturnType<typeof useAppShellState>['activeSettingsCenterGroupKey'];
  activeSettingsCenterPane: ReturnType<typeof useAppShellState>['activeSettingsCenterPane'];
  themeModalSection: ReturnType<typeof useAppProxySettings>['themeModalSection'];
  aiSettingsSection: ReturnType<typeof useAppShellState>['aiSettingsSection'];
  aiSettingsProviderView: ReturnType<typeof useAppShellState>['aiSettingsProviderView'];
  handleOpenToolsModal: ReturnType<typeof useAppSettingsNavigation>['handleOpenToolsModal'];
  handleOpenSettingsModal: ReturnType<typeof useAppSettingsNavigation>['handleOpenSettingsModal'];
  utilityPanelStyle: ReturnType<typeof useAppSecurityUpdate>['utilityPanelStyle'];
  utilityMutedTextStyle: ReturnType<typeof useAppSecurityUpdate>['utilityMutedTextStyle'];
  isWebRuntime: ReturnType<typeof useAppShellState>['isWebRuntime'];
  renderDataDirectorySettings: ReturnType<typeof useAppDirectorySettingsRender>['renderDataDirectorySettings'];
  darkMode: ReturnType<typeof useAppCoreState>['darkMode'];
  overlayTheme: ReturnType<typeof useAppSecurityUpdate>['overlayTheme'];
  effectiveOpacity: ReturnType<typeof useAppShellState>['effectiveOpacity'];
  securityUpdateStatus: ReturnType<typeof useAppShellState>['securityUpdateStatus'];
  securityUpdateSettingsFocusTarget: ReturnType<typeof useAppShellState>['securityUpdateSettingsFocusTarget'];
  securityUpdateSettingsFocusRequest: ReturnType<typeof useAppShellState>['securityUpdateSettingsFocusRequest'];
  handleStartSecurityUpdate: ReturnType<typeof useAppSecurityUpdate>['handleStartSecurityUpdate'];
  handleRetrySecurityUpdate: ReturnType<typeof useAppSecurityUpdate>['handleRetrySecurityUpdate'];
  handleRestartSecurityUpdate: ReturnType<typeof useAppSecurityUpdate>['handleRestartSecurityUpdate'];
  handleSecurityUpdateIssueAction: ReturnType<typeof useAppSecurityUpdate>['handleSecurityUpdateIssueAction'];
  handleOpenSettingsCenterPane: ReturnType<typeof useAppSettingsNavigation>['handleOpenSettingsCenterPane'];
  handleDownloadSourceChange: ReturnType<typeof useAppBootstrapEffects>['handleDownloadSourceChange'];
  downloadSourceSaving: ReturnType<typeof useAppShellState>['downloadSourceSaving'];
  downloadSource: ReturnType<typeof useAppShellState>['downloadSource'];
  toolCenterModalWorkspaceStyle: ReturnType<typeof useAppSecurityUpdate>['toolCenterModalWorkspaceStyle'];
  toolCenterModalSplitStyle: ReturnType<typeof useAppSecurityUpdate>['toolCenterModalSplitStyle'];
  toolCenterNavPanelStyle: ReturnType<typeof useAppSecurityUpdate>['toolCenterNavPanelStyle'];
  toolCenterContentPanelStyle: ReturnType<typeof useAppSecurityUpdate>['toolCenterContentPanelStyle'];
  activeSettingsCenterDetailPanelStyle: ReturnType<typeof useAppSettingsCenterRender>['activeSettingsCenterDetailPanelStyle'];
  toolCenterDetailBodyStyle: ReturnType<typeof useAppSecurityUpdate>['toolCenterDetailBodyStyle'];
  settingsCenterDetailBodyStyle: ReturnType<typeof useAppSettingsCenterRender>['settingsCenterDetailBodyStyle'];
  renderSettingsCenterPane: ReturnType<typeof useAppSettingsCenterRender>['renderSettingsCenterPane'];
  renderSettingsCenterAboutFooter: ReturnType<typeof useAppAboutSettingsRender>['renderSettingsCenterAboutFooter'];
}

export const renderAppSettingsCenterModal = ({
  t, handleOpenToolCenterPane,
  securityUpdateEntryVisibility, securityUpdateHasLegacySensitiveItems, securityUpdateStatusMeta,
  handleCancelSettingsCenterPane, settingsCenterGroups,
  activeSettingsCenterGroupKey, activeSettingsCenterPane, themeModalSection, aiSettingsSection,
  aiSettingsProviderView, handleOpenToolsModal, handleOpenSettingsModal,
  utilityPanelStyle, utilityMutedTextStyle, isWebRuntime, renderDataDirectorySettings, darkMode,
  overlayTheme, effectiveOpacity, securityUpdateStatus, securityUpdateSettingsFocusTarget,
  securityUpdateSettingsFocusRequest, handleStartSecurityUpdate, handleRetrySecurityUpdate,
  handleRestartSecurityUpdate, handleSecurityUpdateIssueAction, handleOpenSettingsCenterPane,
  handleDownloadSourceChange, downloadSourceSaving, downloadSource,
  toolCenterModalWorkspaceStyle, toolCenterModalSplitStyle, toolCenterNavPanelStyle,
  toolCenterContentPanelStyle, activeSettingsCenterDetailPanelStyle, toolCenterDetailBodyStyle,
  settingsCenterDetailBodyStyle, renderSettingsCenterPane, renderSettingsCenterAboutFooter,
}: RenderAppSettingsCenterModalInput) => {
  const { toolCenterGroups } = buildToolCenterGroups({
    t, handleOpenToolCenterPane,
    securityUpdateEntryVisibility, securityUpdateHasLegacySensitiveItems, securityUpdateStatusMeta,
  });
  const combinedSettingsCenterGroups = [
    ...settingsCenterGroups.filter((group) => group.key !== 'about'),
    ...toolCenterGroups,
    ...settingsCenterGroups.filter((group) => group.key === 'about'),
  ];
  const activeSettingsCenterGroup = combinedSettingsCenterGroups.find(
    (group) => group.key === activeSettingsCenterGroupKey,
  ) ?? combinedSettingsCenterGroups[0];
  const activeSettingsCenterTreeItemKey = activeSettingsCenterPane?.key === 'theme'
    ? `theme-${themeModalSection}`
    : activeSettingsCenterPane?.key === 'ai'
      ? (aiSettingsSection === 'providers' && aiSettingsProviderView === 'connected'
          ? 'ai-providers-connected'
          : `ai-${aiSettingsSection}`)
      : (activeSettingsCenterPane?.key ?? null);
  const activeSettingsCenterPaneItem = activeSettingsCenterPane
    ? (
        findSettingsCenterTreeItem(
          combinedSettingsCenterGroups,
          activeSettingsCenterPane.group,
          activeSettingsCenterTreeItemKey,
        )
        ?? findSettingsCenterTreeItem(
          combinedSettingsCenterGroups,
          activeSettingsCenterPane.group,
          activeSettingsCenterPane.key,
        )
      )
    : null;
  const isActiveToolCenterPane = activeSettingsCenterPane
    ? isToolCenterGroupKey(activeSettingsCenterPane.group)
    : false;
  if (!activeSettingsCenterGroup) {
    return null;
  }
  const activateSettingsCenterGroup = (group: typeof combinedSettingsCenterGroups[number]) => {
    if (isToolCenterGroupKey(group.key)) {
      handleOpenToolsModal(group.key);
      return;
    }
    handleOpenSettingsModal(group.key);
  };
  const { renderToolCenterPane } = createToolCenterPaneRenderer({
    activeSettingsCenterPane,
    utilityPanelStyle, utilityMutedTextStyle, t, isWebRuntime,
    renderDataDirectorySettings, handleCancelSettingsCenterPane, darkMode,
    overlayTheme, effectiveOpacity, securityUpdateStatus, securityUpdateSettingsFocusTarget,
    securityUpdateSettingsFocusRequest, handleStartSecurityUpdate, handleRetrySecurityUpdate,
    handleRestartSecurityUpdate, handleSecurityUpdateIssueAction, handleOpenSettingsCenterPane,
    handleDownloadSourceChange, downloadSourceSaving, downloadSource,
  });

  return (
    <SettingsCenterWorkbenchRegistrar>
      <div
        className={`gonavi-settings-center-modal gonavi-settings-center-workbench${activeSettingsCenterPane?.key === 'ai' ? ' gonavi-provider-settings-host' : ''}`}
        style={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'transparent',
        }}
      >
      <div style={{ ...toolCenterModalWorkspaceStyle, flex: 1, minHeight: 0, padding: '4px 0 8px 8px' }}>
          <div className="gonavi-settings-center-layout" style={toolCenterModalSplitStyle}>
          <div className="gonavi-settings-center-groups" style={toolCenterNavPanelStyle}>
            <SettingsCenterTreeNav
              groups={combinedSettingsCenterGroups}
              activeGroupKey={activeSettingsCenterGroup.key}
              activeItemKey={activeSettingsCenterTreeItemKey}
              darkMode={darkMode}
              overlayTheme={overlayTheme}
              ariaLabel={t('app.settings.title')}
              onSelectGroup={(groupKey) => {
                const group = combinedSettingsCenterGroups.find((entry) => entry.key === groupKey);
                if (group) {
                  activateSettingsCenterGroup(group);
                }
              }}
            />
          </div>
          <div
            className="gonavi-settings-center-content"
            style={toolCenterContentPanelStyle}
          >
            {activeSettingsCenterPane ? (
              <div style={activeSettingsCenterDetailPanelStyle}>
                {/* 侧栏树已显示当前项，内容区不再重复标题/说明 */}
                <div
                  key={activeSettingsCenterPane.key}
                  style={isActiveToolCenterPane ? toolCenterDetailBodyStyle : settingsCenterDetailBodyStyle}
                >
                  {isActiveToolCenterPane ? renderToolCenterPane() : renderSettingsCenterPane()}
                </div>
                {!isActiveToolCenterPane && activeSettingsCenterPane.key === 'about-go-navi' && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 8,
                      paddingTop: 10,
                      marginTop: 10,
                      flexShrink: 0,
                    }}
                  >
                    {renderSettingsCenterAboutFooter()}
                  </div>
                )}
              </div>
            ) : (
              <div style={activeSettingsCenterDetailPanelStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 'calc(var(--gn-font-size, 14px) * 1.14)', fontWeight: 700, color: overlayTheme.titleText }}>{activeSettingsCenterGroup.title}</div>
                  <div style={utilityMutedTextStyle}>{activeSettingsCenterGroup.description}</div>
                </div>
                <div style={{ flex: 1 }} />
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </SettingsCenterWorkbenchRegistrar>
  );
};
