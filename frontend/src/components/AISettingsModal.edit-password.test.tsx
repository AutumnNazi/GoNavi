import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AISettingsModal.tsx', import.meta.url), 'utf8');
const aiChatPanelCss = readFileSync(new URL('./AIChatPanel.css', import.meta.url), 'utf8');
const providersSectionSource = readFileSync(new URL('./ai/AISettingsProvidersSection.tsx', import.meta.url), 'utf8');

describe('AISettingsModal edit password behavior', () => {
  it('loads editable provider details before opening the edit modal', () => {
    expect(source).toContain("typeof Service?.AIGetEditableProvider === 'function'");
    expect(source).toContain('await Service.AIGetEditableProvider(p.id)');
  });

  it('loads and saves user-level custom prompts through the AI service', () => {
    expect(source).toContain("callOrFallback(() => Service.AIGetUserPromptSettings?.(), EMPTY_AI_USER_PROMPT_SETTINGS)");
    expect(source).toContain('await Service?.AISaveUserPromptSettings?.(payload);');
    expect(source).toContain("window.dispatchEvent(new CustomEvent('gonavi:ai:config-changed'))");
    expect(source).toContain("import AISettingsPromptsSection from './ai/AISettingsPromptsSection';");
    expect(source).toContain('<AISettingsPromptsSection');
  });

  it('localizes user prompt settings toast fallbacks', () => {
    expect(source).toContain("messageApi.success(t('ai_settings.prompts.message.saved'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.prompts.message.save_failed'))");
    expect(source).not.toContain("'自定义提示词已保存'");
    expect(source).not.toContain("'保存自定义提示词失败'");
  });

  it('localizes MCP server toast fallbacks', () => {
    expect(source).toContain("messageApi.success(t('ai_settings.mcp_server.message.saved'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.mcp_server.message.save_failed'))");
    expect(source).toContain("messageApi.success(t('ai_settings.mcp_server.message.deleted'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.mcp_server.message.delete_failed'))");
    expect(source).toContain("messageApi.success(res?.message || t('ai_settings.mcp_server.message.test_success'))");
    expect(source).toContain("messageApi.error(res?.message || t('ai_settings.mcp_server.message.test_failed'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.mcp_server.message.test_request_failed'))");
    expect(source).not.toContain("'MCP 服务已保存'");
    expect(source).not.toContain("'保存 MCP 服务失败'");
    expect(source).not.toContain("'MCP 服务已删除'");
    expect(source).not.toContain("'删除 MCP 服务失败'");
    expect(source).not.toContain("'MCP 服务连接成功'");
    expect(source).not.toContain("'MCP 服务测试失败'");
    expect(source).not.toContain("'测试 MCP 服务失败'");
  });

  it('localizes Skill toast fallbacks', () => {
    expect(source).toContain("messageApi.success(t('ai_settings.skill.message.saved'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.skill.message.save_failed'))");
    expect(source).toContain("messageApi.success(t('ai_settings.skill.message.deleted'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.skill.message.delete_failed'))");
    expect(source).not.toContain("'Skill 已保存'");
    expect(source).not.toContain("'保存 Skill 失败'");
    expect(source).not.toContain("'Skill 已删除'");
    expect(source).not.toContain("'删除 Skill 失败'");
  });

  it('localizes MCP HTTP control and copy fallbacks', () => {
    expect(source).toContain("throw new Error(t('ai_settings.clipboard.error.unsupported'))");
    expect(source).toContain("throw new Error(t('ai_settings.mcp_http.error.control_unsupported_runtime'))");
    expect(source).toContain("throw new Error(t('ai_settings.mcp_http.error.start_unsupported_version'))");
    expect(source).toContain("throw new Error(t('ai_settings.mcp_http.error.stop_unsupported_version'))");
    expect(source).toContain("messageApi.success(checked ? t('ai_settings.mcp_http.message.started') : t('ai_settings.mcp_http.message.stopped'))");
    expect(source).toContain("messageApi.error(e?.message || t('ai_settings.mcp_http.message.toggle_failed'))");
    expect(source).toContain("messageApi.error(t('ai_settings.mcp_http.message.url_unavailable'))");
    expect(source).toContain("copyTextToClipboard(url, t('ai_settings.mcp_http.message.url_copied'))");
    expect(source).toContain("messageApi.error(t('ai_settings.mcp_http.message.authorization_header_required'))");
    expect(source).toContain("copyTextToClipboard(`Authorization: ${authorizationHeader}`, t('ai_settings.mcp_http.message.authorization_header_copied'))");
    expect(source).not.toContain("'当前环境不支持复制到剪贴板'");
    expect(source).not.toContain("'当前运行时暂不支持 MCP HTTP 服务控制'");
    expect(source).not.toContain("'当前版本暂不支持启动 MCP HTTP 服务'");
    expect(source).not.toContain("'当前版本暂不支持停止 MCP HTTP 服务'");
    expect(source).not.toContain("'GoNavi MCP HTTP 服务已启动'");
    expect(source).not.toContain("'GoNavi MCP HTTP 服务已停止'");
    expect(source).not.toContain("'切换 GoNavi MCP HTTP 服务失败'");
    expect(source).not.toContain("'当前没有可复制的 MCP HTTP URL'");
    expect(source).not.toContain("'MCP HTTP URL 已复制'");
    expect(source).not.toContain("'请先启动 MCP HTTP 服务生成 Authorization Header'");
    expect(source).not.toContain("'Authorization Header 已复制'");
  });

  it('refreshes the persisted MCP HTTP status when a toggle request fails', () => {
    expect(source).toContain('let Service: any;');
    expect(source).toContain('const refreshedStatus = await Service?.AIGetMCPHTTPServerStatus?.();');
    expect(source).toContain('状态回填仅用于反映已持久化的开关意图');
  });

  it('localizes MCP HTTP default status fallback', () => {
    expect(source).toContain("const defaultMCPHTTPServerStatus = useMemo<AIMCPHTTPServerStatus>(() => ({");
    expect(source).toContain("message: t('ai_settings.mcp_http.status.not_running')");
    expect(source).toContain("useState<AIMCPHTTPServerStatus>(() => defaultMCPHTTPServerStatus)");
    expect(source).not.toContain("'GoNavi MCP HTTP 服务未启动'");
  });

  it('localizes Skill required built-in tool option labels', () => {
    expect(source).toContain("label: `${tool.name} · ${t('ai_settings.tools.builtin_tool_label')}`");
    expect(source).toContain("]), [mcpTools, t]);");
    expect(source).not.toContain("label: `${tool.name} · 内置工具`");
    expect(source).not.toContain("· 内置工具");
  });

  it('loads MCP servers and skills through the AI service', () => {
    expect(source).toContain('Service.AIGetMCPClientInstallStatuses?.()');
    expect(source).toContain('Service.AIGetMCPServers?.()');
    expect(source).toContain('Service.AIListMCPTools?.()');
    expect(source).toContain('Service.AIGetSkills?.()');
    expect(source).toContain("import AISettingsSkillsSection from './ai/AISettingsSkillsSection';");
    expect(source).toContain('<AISettingsSkillsSection');
  });

  it('delegates bulky MCP and built-in tool sections to dedicated ai components', () => {
    expect(source).toContain("import AIBuiltinToolsCatalog from './ai/AIBuiltinToolsCatalog';");
    expect(source).toContain("import AISettingsProvidersSection from './ai/AISettingsProvidersSection';");
    expect(source).toContain("import AISettingsSidebar, { AI_SETTINGS_NAV_ITEMS, type AISettingsSectionKey } from './ai/AISettingsSidebar';");
    expect(source).toContain("import AISettingsSafetySection from './ai/AISettingsSafetySection';");
    expect(source).toContain("import AISettingsContextSection from './ai/AISettingsContextSection';");
    expect(source).toContain('<AISettingsProvidersSection');
    expect(source).toContain("import AISettingsMCPSection from './ai/AISettingsMCPSection';");
    expect(source).toContain('<AISettingsSidebar');
    expect(source).toContain('<AISettingsSafetySection');
    expect(source).toContain('<AISettingsContextSection');
    expect(source).toContain('<AISettingsMCPSection');
    expect(source).toContain('<AIBuiltinToolsCatalog');
  });

  it('keeps every AI section mounted while exposing only the active tabpanel', () => {
    const sectionPanelStart = source.indexOf('const renderSectionPanel =');
    const sectionPanelEnd = source.indexOf('\n    return (', sectionPanelStart);
    const sectionPanelSource = source.slice(sectionPanelStart, sectionPanelEnd);

    expect(source).toContain('const renderSectionPanel = (sectionKey: AISettingsSectionKey, content: React.ReactNode) => {');
    expect(source).toContain('hidden={activeSection !== sectionKey}');
    expect(source).toContain('id={`gonavi-ai-settings-panel-${sectionKey}`}');
    expect(source).toContain('aria-labelledby={`gonavi-ai-settings-tab-${sectionKey}`}');
    expect(source).toContain('role="tabpanel"');

    for (const sectionKey of ['providers', 'safety', 'context', 'mcp', 'skills', 'tools', 'prompts']) {
      expect(source).toContain(`renderSectionPanel('${sectionKey}', (`);
    }

    expect(source).not.toContain('key={activeSection}');
    expect(source).not.toContain("{activeSection === 'mcp' && (");
    expect(source).not.toContain("{activeSection === 'tools' && (");
    expect(sectionPanelSource).not.toContain('borderBottom');
  });

  it('resets the shared AI settings scroll region after section navigation', () => {
    expect(source).toContain('const settingsContentScrollRef = useRef<HTMLDivElement>(null);');
    expect(source).toContain('ref={settingsContentScrollRef}');
    expect(source).toContain('scrollRegion.scrollTop = 0;');
    expect(source).toContain('scrollRegion.scrollLeft = 0;');
    expect(source).toContain('}, [activeSection]);');
  });

  it('wires the external MCP client install panel actions back to the modal handlers', () => {
    expect(source).toContain('mcpClientStatuses={mcpClientStatuses}');
    expect(source).toContain('selectedMCPClient={selectedMCPClient}');
    expect(source).toContain("import { useAIMCPClientInstaller } from './ai/useAIMCPClientInstaller';");
    expect(source).toContain('} = useAIMCPClientInstaller({');
    expect(source).toContain('handleSelectMCPClient,');
    expect(source).toContain('loadMCPClientStatuses,');
    expect(source).toContain('selectedMCPClientStatus,');
    expect(source).toContain('onSelectClient={handleSelectMCPClient}');
    expect(source).toContain('onRefreshStatus={() => void loadMCPClientStatuses()}');
    expect(source).toContain('onCopyConfigPath={() => void handleCopySelectedMCPConfigPath()}');
    expect(source).toContain('onCopyLaunchCommand={() => void handleCopySelectedMCPLaunchCommand()}');
    expect(source).toContain('onInstallSelectedClient={handleInstallSelectedMCPClient}');
  });

  it('waits briefly for the AI service bridge before warning and removes noisy provider debug logs', () => {
    expect(source).toContain('const resolveAIService = useCallback(async () => {');
    expect(source).toContain('const service = await waitForAIService();');
    expect(source).not.toContain("console.log('[AI] AIGetProviders result:'");
    expect(source).not.toContain("console.log('[AI] AIGetActiveProvider result:'");
  });

  it('keeps the prefilled api key masked by default', () => {
    expect(source).toContain('const [primaryPasswordVisible, setPrimaryPasswordVisible] = useState(false);');
    expect(providersSectionSource).toContain('visible: primaryPasswordVisible,');
  });

  it('retains an existing API secret but blocks a keyless local-cli to API switch', () => {
    expect(source).toContain('isProviderSecretRequirementSatisfied({');
    expect(source).toContain('canRetainExistingProviderSecret({ currentAuthMode: authMode, editingProvider })');
    expect(source).toContain('retainExistingSecret,');
  });

  it('does not render the clear helper block anymore', () => {
    expect(source).not.toContain('当前已保存 API Key。留空表示继续沿用，输入新值表示替换。');
    expect(source).not.toContain('清除已保存 API Key');
    expect(source).not.toContain('留空表示继续沿用已保存密钥');
  });

  it('renders in-modal test errors through the local message host', () => {
    expect(source).toContain('antdMessage.useMessage({ getContainer: () => modalBodyRef.current || document.body })');
    expect(source).toContain("void messageApi.error(res?.message || t('ai_settings.message.test_failed'))");
    expect(source).not.toContain("`测试失败: ${res?.message || '未知错误'}`");
  });

  it('keeps long ai settings toast errors wrapped within the modal body', () => {
    expect(aiChatPanelCss).toContain('.ai-settings-body .ant-message {');
    expect(aiChatPanelCss).toContain('width: fit-content;');
    expect(aiChatPanelCss).toContain('max-width: min(520px, calc(100% - 32px));');
    expect(aiChatPanelCss).toContain('.ai-settings-body .ant-message .ant-message-notice-content {');
    expect(aiChatPanelCss).toContain('max-width: 100%;');
    expect(aiChatPanelCss).toContain('white-space: normal;');
    expect(aiChatPanelCss).toContain('overflow-wrap: anywhere;');
  });
});
