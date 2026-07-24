import type {
  AIContextItem,
  AIMCPClientInstallStatus,
  AIMCPServerConfig,
  AIMCPToolDescriptor,
  AIProviderConfig,
  AISafetyLevel,
  AISkillConfig,
  AIUserPromptSettings,
} from '../../types';
import { buildAIChatReadinessSnapshot } from './aiChatReadiness';
import { buildAIGuidanceSnapshot } from './aiPromptInsights';
import { buildAIProviderSnapshot } from './aiProviderInsights';
import { buildAIRuntimeSnapshot } from './aiRuntimeInsights';
import { buildMCPSetupSnapshot } from './aiMCPInsights';
import type { AIInspectionTranslator } from './aiInspectionI18n';
import { translateInspectionCopy } from './aiInspectionI18n';

type AISetupHealthStatus = 'ready' | 'needs_attention' | 'blocked';

const appendUnique = (items: string[], value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed || items.includes(trimmed)) {
    return;
  }
  items.push(trimmed);
};

const summarizeSkillNames = (skills: Array<{ name?: string }>) =>
  skills
    .map((skill) => String(skill?.name || '').trim())
    .filter(Boolean)
    .slice(0, 6);

export const buildAISetupHealthSnapshot = (params: {
  providers?: AIProviderConfig[];
  activeProviderId?: string | null;
  safetyLevel?: AISafetyLevel | string;
  contextLevel?: string;
  skills?: AISkillConfig[];
  mcpServers?: AIMCPServerConfig[];
  mcpClientStatuses?: AIMCPClientInstallStatus[];
  mcpTools?: AIMCPToolDescriptor[];
  dynamicModels?: string[];
  builtinToolNames?: string[];
  userPromptSettings?: AIUserPromptSettings;
  activeContext?: { connectionId?: string | null; dbName?: string | null } | null;
  activeContextItems?: AIContextItem[];
  translate?: AIInspectionTranslator;
}) => {
  const translate = params.translate;
  const activeContextItems = Array.isArray(params.activeContextItems) ? params.activeContextItems : [];
  const runtimeSnapshot = buildAIRuntimeSnapshot({
    providers: params.providers,
    activeProviderId: params.activeProviderId,
    safetyLevel: params.safetyLevel,
    contextLevel: params.contextLevel,
    skills: params.skills,
    mcpTools: params.mcpTools,
    dynamicModels: params.dynamicModels,
    builtinToolNames: params.builtinToolNames,
    translate,
  });
  const providerSnapshot = buildAIProviderSnapshot({
    providers: params.providers,
    activeProviderId: params.activeProviderId,
    dynamicModels: params.dynamicModels,
    translate,
  });
  const chatReadiness = buildAIChatReadinessSnapshot({
    providers: params.providers,
    activeProviderId: params.activeProviderId,
    dynamicModels: params.dynamicModels,
    activeContext: params.activeContext,
    activeContextItems,
    translate,
  });
  const mcpSnapshot = buildMCPSetupSnapshot({
    mcpServers: params.mcpServers,
    mcpClientStatuses: params.mcpClientStatuses,
    mcpTools: params.mcpTools,
    translate,
  });
  const guidanceSnapshot = buildAIGuidanceSnapshot({
    userPromptSettings: params.userPromptSettings,
    skills: params.skills,
    translate,
  });

  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];

  if (!providerSnapshot.hasActiveProvider) {
    appendUnique(blockers, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.blocker.no_active_provider',
      'No active AI provider is selected',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.select_provider',
      'Add and select an active provider in AI settings first',
    ));
  }

  const activeProviderIssues = providerSnapshot.activeProvider?.issues || [];
  if (activeProviderIssues.includes('missing_secret')) {
    appendUnique(blockers, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.blocker.missing_secret',
      'The active provider is missing an API Key / Secret',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.fill_secret',
      'Fill in the active provider secret',
    ));
  }
  if (activeProviderIssues.includes('missing_base_url')) {
    appendUnique(blockers, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.blocker.missing_base_url',
      'The active provider is missing a base URL',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.fill_base_url',
      'Fill in the active provider baseUrl',
    ));
  }
  if (activeProviderIssues.includes('missing_selected_model') || chatReadiness.status === 'missing_model') {
    appendUnique(blockers, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.blocker.missing_model',
      'The active provider has no selected model',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.select_model',
      'Select an available model for the active provider',
    ));
  }
  if (chatReadiness.status === 'loading_models') {
    appendUnique(warnings, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.warning.loading_models',
      'The model list is still loading, so model selection is not complete yet',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.wait_models',
      'Wait for the model list to finish loading, then confirm the active model again',
    ));
  }

  if (mcpSnapshot.serverCount === 0) {
    appendUnique(warnings, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.warning.no_mcp_servers',
      'No MCP servers are configured yet',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.add_mcp_server',
      'To extend AI tool capabilities, add and test at least one MCP server',
    ));
  }
  mcpSnapshot.warnings.forEach((warning) => appendUnique(warnings, warning));
  mcpSnapshot.nextActions.forEach((action) => appendUnique(nextActions, action));
  if (mcpSnapshot.currentClientCount === 0) {
    appendUnique(warnings, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.warning.external_client_not_connected',
      'Claude Code / Codex / OpenCode is not connected to the current GoNavi MCP as a local client yet; OpenClaw/Hermans need a remote bridge',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.connect_external_client',
      'To let external Agents use GoNavi MCP, connect local clients such as Claude Code/Codex/OpenCode or configure a remote MCP bridge for cloud Agents',
    ));
  }
  if (mcpSnapshot.enabledServerCount > 0 && runtimeSnapshot.mcpToolCount === 0) {
    appendUnique(warnings, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.warning.no_mcp_tools',
      'MCP servers are enabled, but no available MCP tools have been discovered yet',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.test_mcp_servers',
      'Test each enabled MCP server and confirm its command, arguments, and environment variables can discover tools correctly',
    ));
  }
  if (guidanceSnapshot.customPromptCount === 0 && guidanceSnapshot.enabledSkillCount === 0) {
    appendUnique(warnings, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.warning.no_guidance',
      'No custom prompts or Skills are configured',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.add_guidance',
      'To pin response style or workflow, add custom prompts or enable Skills',
    ));
  }
  if (chatReadiness.ready && params.activeContext?.connectionId && activeContextItems.length === 0) {
    appendUnique(warnings, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.warning.no_schema_context',
      'Chat is ready, but no table schema context is attached yet',
    ));
    appendUnique(nextActions, translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.next_action.attach_schema_context',
      'For more accurate SQL or schema suggestions, attach the target table schema to AI context first',
    ));
  }

  const status: AISetupHealthStatus = blockers.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'needs_attention'
      : 'ready';

  const message = status === 'ready'
    ? translateInspectionCopy(
      translate,
      'ai_chat.inspection.setup.message.ready',
      'AI setup health passed; provider, chat prerequisites, and MCP runtime path are available',
    )
    : status === 'blocked'
      ? translateInspectionCopy(
        translate,
        'ai_chat.inspection.setup.message.blocked',
        `AI setup has ${blockers.length} blockers; fix the active provider and chat prerequisites first`,
        { count: blockers.length },
      )
      : translateInspectionCopy(
        translate,
        'ai_chat.inspection.setup.message.needs_attention',
        `AI setup is usable overall, but ${warnings.length} recommendations can still be optimized`,
        { count: warnings.length },
      );

  return {
    status,
    ready: status === 'ready',
    message,
    blockers,
    warnings,
    nextActions,
    summary: {
      providerCount: providerSnapshot.providerCount,
      readyProviderCount: providerSnapshot.readyProviderCount,
      hasActiveProvider: providerSnapshot.hasActiveProvider,
      activeProviderName: providerSnapshot.activeProvider?.name || providerSnapshot.activeProvider?.id || '',
      chatStatus: chatReadiness.status,
      chatReady: chatReadiness.ready,
      safetyLevel: runtimeSnapshot.safetyLevel,
      safetyLabel: runtimeSnapshot.safetyLabel,
      contextLevel: runtimeSnapshot.contextLevel,
      contextLabel: runtimeSnapshot.contextLabel,
      enabledSkillCount: guidanceSnapshot.enabledSkillCount,
      customPromptCount: guidanceSnapshot.customPromptCount,
      mcpServerCount: mcpSnapshot.serverCount,
      enabledMCPServerCount: mcpSnapshot.enabledServerCount,
      mcpServerConfigurationIssueCount: mcpSnapshot.serverConfigurationIssueCount,
      mcpServersWithConfigurationErrors: mcpSnapshot.serversWithConfigurationErrors,
      installedExternalClientCount: mcpSnapshot.installedClientCount,
      currentExternalClientCount: mcpSnapshot.currentClientCount,
      discoveredMCPToolCount: mcpSnapshot.discoveredMCPToolCount,
      totalAvailableToolCount: runtimeSnapshot.totalAvailableToolCount,
      contextAttachedCount: chatReadiness.contextAttachedCount,
    },
    runtime: runtimeSnapshot,
    provider: providerSnapshot,
    chatReadiness,
    mcp: mcpSnapshot,
    guidance: {
      ...guidanceSnapshot,
      enabledSkillPreview: summarizeSkillNames(guidanceSnapshot.enabledSkills),
    },
  };
};
