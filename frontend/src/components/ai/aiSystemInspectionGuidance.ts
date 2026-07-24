import type { AISystemContextMessage } from './aiSystemContextMessages';
import type { AIInspectionTranslator } from './aiInspectionI18n';
import { translateInspectionCopy } from './aiInspectionI18n';

const INSPECTION_GUIDANCE_KEY_PREFIX = 'ai_chat.system.inspection_guidance';

const INSPECTION_GUIDANCE_FALLBACKS = {
  inspect_ai_runtime:
    'If the user asks which model is active, what the current safety level is, which tools are available, or which Skills / MCP tools are enabled, call inspect_ai_runtime first to read the current AI runtime state instead of answering from memory or assumptions.',
  inspect_ai_safety:
    'If the user asks why writing is blocked, whether the current mode is read-only, whether DDL can run, or whether allowMutating should be passed, call inspect_ai_safety first to read the real safety boundary instead of guessing from UI state or memory.',
  inspect_ai_context:
    'If the user asks about the current AI context, associated tables, or table schemas attached to the session, call inspect_ai_context first to read the mounted table-schema context instead of repeating from memory.',
  inspect_app_health:
    'If the user reports unstable AI behavior, asks for an overall check, asks about obvious GoNavi AI issues, wants connection, MCP, and log diagnostics together, or mentions abnormal AI reply bubbles, call inspect_app_health first to get the global health overview, then decide whether to drill into inspect_ai_setup_health, inspect_app_logs, inspect_recent_connection_failures, or inspect_ai_last_render_error.',
  inspect_ai_support_bundle:
    'If the user says the AI is immature or unstable, asks to export troubleshooting material, wants MCP, connection, logs, and context inspected together, or is preparing to hand the issue to development, call inspect_ai_support_bundle first to create a support bundle without secrets or database passwords, then drill down based on warnings and nextActions.',
  inspect_ai_tool_catalog:
    'If the user question spans multiple features, you are unsure which built-in tool to call first, or the user asks what tools exist, how to fill tool parameters, or which probe fits a problem type, call inspect_ai_tool_catalog first to read the real tool catalog, recommended workflow, and parameter hints before choosing a concrete probe.',
  inspect_ai_setup_health:
    'If the user asks why AI is hard to use, asks for a health check of the current AI configuration, or asks about obvious current AI issues, call inspect_ai_setup_health first to get the overall state, then drill into inspect_ai_providers, inspect_ai_chat_readiness, inspect_mcp_setup, or inspect_ai_guidance as needed.',
  inspect_ai_chat_readiness:
    'If the user asks why sending is unavailable, what configuration the current AI chat is missing, or whether the input area is ready, call inspect_ai_chat_readiness first to read the real pre-send state instead of judging only from UI state or memory.',
  inspect_ai_upstream_logs:
    'If the user mentions upstream AI requests, request parameters, request body, requestId, model payloads, tools not triggering, or the exact upstream error payload, call inspect_ai_upstream_logs first to read the redacted request log and payload-structure summary, then continue with inspect_ai_providers or inspect_ai_message_flow as needed.',
  inspect_ai_providers:
    'If the user asks which providers are configured, why the model list is empty, whether an API Key is configured, or why sending is unavailable / no model is selected, call inspect_ai_providers first to read the real provider configuration instead of guessing from memory.',
  inspect_mcp_setup:
    'If the user asks which MCP servers are configured, whether Claude / Codex / OpenCode is connected to the GoNavi MCP, why an external client cannot use it, or which MCP services are enabled, call inspect_mcp_setup first to read the real MCP configuration and external-client access state instead of guessing from memory.',
  inspect_mcp_runtime_failures:
    'If the user mentions a failed new MCP test, zero discovered tools, MCP tool-call failures, stdio disconnects, Docker MCP exits, or HTTP MCP startup failures, call inspect_mcp_runtime_failures first to read real MCP runtime failure logs and current service discovery state, then decide whether to drill into inspect_mcp_draft, inspect_mcp_docker_setup, or inspect_mcp_setup.',
  inspect_mcp_authoring_guide:
    'If the user does not know how to fill command / args / env / timeout for a new MCP server, asks for a node / uvx / python template, or asks why a startup command cannot be entered as one full line, call inspect_mcp_authoring_guide first to read the real authoring guide and templates. If the user has already pasted a command or draft, call inspect_mcp_draft to evaluate it with the real validator instead of explaining from memory.',
  inspect_mcp_draft:
    'If the user pastes an MCP README startup command, a command / args / env / timeout draft, or asks how to fill that MCP command in GoNavi, call inspect_mcp_draft first to return automatic splitting, launch preview, suggestedServerSeed, configuration errors / warnings, and nextActions, then give the user concrete values.',
  inspect_mcp_tool_schema:
    'If the user asks how to fill parameters for an MCP tool, reports an MCP tool argument error, or asks how to write the arguments JSON for an MCP tool, call inspect_mcp_tool_schema first to read the real inputSchema. If the alias is unknown, call inspect_mcp_setup first to find the currently discovered tool alias.',
  inspect_ai_guidance:
    'If the user asks which prompts are currently attached, which Skills are active, why you answered in a certain way, or what the current database / JVM prompt is, call inspect_ai_guidance first to read the real prompt and Skill configuration instead of summarizing from memory.',
  inspect_shortcuts:
    'If the user asks what a shortcut is, how it differs between Win and Mac, what the result-area / AI panel / SQL execution shortcut is, or whether they changed the default shortcut, call inspect_shortcuts first to read the real shortcut configuration and platform differences instead of answering default values from memory.',
  inspect_recent_connection_failures:
    'If the user asks why a connection cannot be established, mentions recent connection failure cooldown, validation failure, SSH tunnel issues, or multiStatements / parameter compatibility exceptions, call inspect_recent_connection_failures first to read the real connection failure summary, then decide whether to drill into inspect_current_connection, inspect_saved_connections, or inspect_app_logs.',
  inspect_app_logs:
    'If the user mentions gonavi.log, recent logs, startup errors, MCP startup failures, or database connection failures, call inspect_app_logs first to read the real application log tail. Continue filtering by keyword if needed instead of guessing only from a dialog or toast.',
  inspect_ai_last_render_error:
    'If the user says an AI message is blank, a bubble failed to render, or a message block error was isolated without breaking the whole panel, call inspect_ai_last_render_error first to read the most recent isolated frontend render exception instead of guessing from a screenshot.',
  inspect_ai_message_flow:
    'If the user says an AI reply was split into multiple bubbles, the model did not continue after tool calls, message stream state is wrong, or one turn was not appended to the same bubble, call inspect_ai_message_flow first to read the real current-session message structure, consecutive assistant messages, and unresolved tool calls instead of guessing from UI state.',
  inspect_ai_context_budget:
    'If the user says AI is slow, context is too large, too many table schemas are mounted, tool results are too long, the model starts answering unreliably, or a complex task needs context sizing before execution, call inspect_ai_context_budget first to read the size risks for messages, DDL, MCP schema, prompts, and Skills, then decide whether to narrow context or split the task.',
  inspect_codebase_hotspots:
    'If the user mentions bloated multi-thousand-line files, continuing to split large components, which file should be split next, or whether AI / MCP / UI changes are risky, call inspect_codebase_hotspots first to read large-file hotspots, suggested split slices, and test targets before defining the change scope.',
  inspect_current_connection:
    'If the user asks about the current connection, current data source, which database or address is connected, or whether the connection uses SSH / proxy, call inspect_current_connection first to read the active connection summary instead of guessing from UI state or memory.',
  inspect_connection_capabilities:
    'If the user asks why database creation / deletion / renaming is unavailable, why result editing is unavailable, or which frontend actions this data source supports, call inspect_connection_capabilities first to read the real connection capability matrix instead of relying on database common knowledge or memory.',
  inspect_saved_connections:
    'If the user asks which connections are stored locally, asks to find a MySQL / PostgreSQL / Redis connection, or asks which connection uses SSH / proxy, call inspect_saved_connections first to read the real local connection list, then decide which connection to inspect next.',
  inspect_redis_topology:
    'If the user mentions Redis Sentinel / cluster, Sentinel master, Redis Cluster multi-database behavior, Redis DB switching failures, or how to fill multiple Redis nodes, call inspect_redis_topology first to read the real Redis topology, nodes, authentication state, and risk hints instead of guessing from default ports or experience.',
  inspect_external_sql_directories:
    'If the user mentions external SQL directories, scripts inside a directory, where a specific SQL file is stored, or where the currently opened SQL file came from, call inspect_external_sql_directories first to read the real external SQL directory assets, then decide whether to read the active tab or locate a concrete script.',
  inspect_external_sql_file:
    'If the user provides an external SQL file path or explicitly asks to inspect report.sql / job.sql in a directory, call inspect_external_sql_file first to read the real file content. If the file is already open in the editor, combine it with inspect_active_tab to check the current draft.',
  inspect_recent_sql_activity:
    'If the user asks what was run recently, whether data was just deleted, whether recent work was mostly reads or writes, or which database recently had the most errors, call inspect_recent_sql_activity first to read the recent SQL activity summary, then decide whether to drill into inspect_recent_sql_logs for concrete statements.',
  inspect_sql_editor_transaction:
    'If the user asks about manual commit / autocommit in the SQL editor, whether there is an uncommitted transaction, whether update / insert / delete will auto-commit, or whether transaction semantics were misunderstood, call inspect_sql_editor_transaction first to read the real commit settings, pending transactions, and whether the current SQL tab will enter a managed transaction instead of explaining from memory.',
  inspect_sql_risk:
    'If the user asks you to execute, delete, update, run DDL, run bulk SQL, or asks whether a SQL statement can run / is dangerous, call inspect_sql_risk first to check the current editor or supplied SQL for statement count, write / DDL risk, WHERE conditions, and safety policy result. When high / critical risk is found, explain the risk and ask for confirmation before proceeding.',
  inspect_saved_queries:
    'If the user mentions saved queries, SQL history, a previously written statement, or asks to find an earlier script, call inspect_saved_queries first to read locally saved queries, then decide whether to verify fields or reuse SQL.',
  inspect_ai_sessions:
    'If the user mentions a previous AI conversation, a prior discussion, or asks which recent session talked about this problem, call inspect_ai_sessions first to read the local AI session list and previews, then decide whether to inspect the current tab or reuse historical SQL.',
  inspect_sql_snippets:
    'If the user mentions SQL snippets, snippet templates, template prefixes, or common templates, call inspect_sql_snippets first to read the local SQL snippet library instead of inventing existing templates from memory.',
} as const;

type InspectionGuidanceToolName = keyof typeof INSPECTION_GUIDANCE_FALLBACKS;

const guidanceKey = (toolName: InspectionGuidanceToolName): string =>
  `${INSPECTION_GUIDANCE_KEY_PREFIX}.${toolName}`;

const buildGuidanceContent = (
  toolName: InspectionGuidanceToolName,
  translate?: AIInspectionTranslator,
): string => translateInspectionCopy(
  translate,
  guidanceKey(toolName),
  INSPECTION_GUIDANCE_FALLBACKS[toolName],
);

const appendGuidanceIfToolAvailable = (
  messages: AISystemContextMessage[],
  availableToolNames: string[],
  toolName: InspectionGuidanceToolName,
  translate?: AIInspectionTranslator,
) => {
  if (!availableToolNames.includes(toolName)) {
    return;
  }
  messages.push({ role: 'system', content: buildGuidanceContent(toolName, translate) });
};

const appendAIRuntimeInspectionGuidance = (
  messages: AISystemContextMessage[],
  availableToolNames: string[],
  translate?: AIInspectionTranslator,
) => {
  appendGuidanceIfToolAvailable(messages, availableToolNames, 'inspect_ai_runtime', translate);
};

const appendAISafetyInspectionGuidance = (
  messages: AISystemContextMessage[],
  availableToolNames: string[],
  translate?: AIInspectionTranslator,
) => {
  appendGuidanceIfToolAvailable(messages, availableToolNames, 'inspect_ai_safety', translate);
};

export const appendJVMInspectionGuidanceMessages = (
  messages: AISystemContextMessage[],
  availableToolNames: string[],
  translate?: AIInspectionTranslator,
) => {
  appendAIRuntimeInspectionGuidance(messages, availableToolNames, translate);
  appendAISafetyInspectionGuidance(messages, availableToolNames, translate);
};

export const appendDatabaseInspectionGuidanceMessages = (
  messages: AISystemContextMessage[],
  availableToolNames: string[],
  translate?: AIInspectionTranslator,
) => {
  const databaseGuidanceTools: InspectionGuidanceToolName[] = [
    'inspect_ai_context',
    'inspect_ai_runtime',
    'inspect_app_health',
    'inspect_ai_support_bundle',
    'inspect_ai_tool_catalog',
    'inspect_ai_setup_health',
    'inspect_ai_safety',
    'inspect_ai_chat_readiness',
    'inspect_ai_upstream_logs',
    'inspect_ai_providers',
    'inspect_mcp_setup',
    'inspect_mcp_runtime_failures',
    'inspect_mcp_authoring_guide',
    'inspect_mcp_draft',
    'inspect_mcp_tool_schema',
    'inspect_ai_guidance',
    'inspect_shortcuts',
    'inspect_recent_connection_failures',
    'inspect_app_logs',
    'inspect_ai_last_render_error',
    'inspect_ai_message_flow',
    'inspect_ai_context_budget',
    'inspect_codebase_hotspots',
    'inspect_current_connection',
    'inspect_connection_capabilities',
    'inspect_saved_connections',
    'inspect_redis_topology',
    'inspect_external_sql_directories',
    'inspect_external_sql_file',
    'inspect_recent_sql_activity',
    'inspect_sql_editor_transaction',
    'inspect_sql_risk',
    'inspect_saved_queries',
    'inspect_ai_sessions',
    'inspect_sql_snippets',
  ];

  databaseGuidanceTools.forEach((toolName) => {
    appendGuidanceIfToolAvailable(messages, availableToolNames, toolName, translate);
  });
};
