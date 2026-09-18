import type { AIBuiltinToolInfo } from './aiBuiltinToolInfo.types';

export interface AIBuiltinToolFlow {
  title: string;
  steps: string;
  description: string;
}

export interface AIBuiltinToolParameterHint {
  name: string;
  required: boolean;
  typeLabel: string;
  description: string;
  enumValues: string[];
  defaultValue: string;
  exampleValue: string;
}

type BuiltinToolFlowTranslator = (key: string) => string;

interface BuiltinToolFlowCopy extends AIBuiltinToolFlow {
  key: string;
}

const BUILTIN_TOOL_FLOW_KEY_PREFIX = 'ai_chat.builtin_tools.flows';

const translateBuiltinToolFlow = (
  t: BuiltinToolFlowTranslator | undefined,
  key: string,
  fallback: string,
): string => {
  if (!t) return fallback;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
};

const BUILTIN_TOOL_FLOW_COPY: BuiltinToolFlowCopy[] = [
  {
    key: 'locate_table_fields',
    title: 'Locate tables and fields',
    steps: 'get_connections -> get_server_version -> get_databases -> get_tables -> get_columns',
    description: 'Find the connection and its live database version first, then confirm real field names before generating SQL.',
  },
  {
    key: 'field_lookup_table',
    title: 'Find tables by field',
    steps: 'get_databases -> get_all_columns',
    description: 'Use when only a field name, business meaning, or comment keyword is known, but the exact table is still unclear.',
  },
  {
    key: 'deep_structure',
    title: 'Deep-dive structure',
    steps: 'get_columns -> get_indexes -> get_foreign_keys -> get_triggers -> get_table_ddl',
    description: 'Use for index optimization, relationship mapping, implicit side-effect investigation, and DDL review.',
  },
  {
    key: 'table_snapshot',
    title: 'One-shot table snapshot',
    steps: 'inspect_table_bundle',
    description: 'Return columns, indexes, foreign keys, triggers, and DDL in one call; sample rows can be included when needed to reduce round trips.',
  },
  {
    key: 'database_overview',
    title: 'Quick database overview',
    steps: 'inspect_database_bundle -> inspect_table_bundle',
    description: 'Start by seeing which tables exist and what fields they roughly contain, then drill into target tables with snapshots.',
  },
  {
    key: 'app_health_overview',
    title: 'AI app health overview',
    steps: 'inspect_app_health -> inspect_ai_setup_health / inspect_app_logs / inspect_recent_connection_failures / inspect_ai_last_render_error / inspect_ai_message_flow',
    description: 'Use when AI instability, connection issues, MCP issues, or message rendering problems overlap and an overall health snapshot is needed first.',
  },
  {
    key: 'support_bundle',
    title: 'Export AI troubleshooting support bundle',
    steps: 'inspect_ai_support_bundle -> inspect_app_health / inspect_ai_context_budget / inspect_ai_message_flow / inspect_mcp_remote_access',
    description: 'Use when troubleshooting evidence needs to be collected at once, without secrets or database passwords.',
  },
  {
    key: 'choose_tool_route',
    title: 'Choose an AI tool route',
    steps: 'inspect_ai_tool_catalog -> inspect_ai_runtime / inspect_mcp_setup',
    description: 'Use keywords to decide which built-in probes to call, how to fill tool arguments, and whether external MCP tools are available.',
  },
  {
    key: 'ai_setup_health',
    title: 'One-shot AI setup health check',
    steps: 'inspect_ai_setup_health -> inspect_ai_providers / inspect_mcp_setup / inspect_ai_guidance',
    description: 'Get an AI configuration health snapshot first, then decide whether to drill into providers, chat readiness, MCP, prompts, Skills, or context.',
  },
  {
    key: 'ai_runtime',
    title: 'Inspect current AI capabilities',
    steps: 'inspect_ai_runtime -> inspect_ai_context / inspect_current_connection',
    description: 'Confirm the current model, safety level, context level, Skills, and MCP tools before choosing a probe chain.',
  },
  {
    key: 'safety_boundary',
    title: 'Check write safety boundaries',
    steps: 'inspect_ai_safety -> inspect_ai_runtime -> inspect_current_connection',
    description: 'Check whether the current state is read-only, whether DDL/DML is allowed, and that MCP execute_sql follows the same safety controls.',
  },
  {
    key: 'providers_models',
    title: 'Troubleshoot providers and models',
    steps: 'inspect_ai_providers -> inspect_ai_runtime',
    description: 'Confirm which providers are configured and active, whether keys or models are missing, and why chat cannot send or model lists are empty.',
  },
  {
    key: 'chat_readiness',
    title: 'Troubleshoot chat send readiness',
    steps: 'inspect_ai_chat_readiness -> inspect_ai_providers',
    description: 'Check which chat input prerequisites are missing, such as active provider, key, endpoint, or selected model, instead of guessing from UI symptoms.',
  },
  {
    key: 'upstream_request',
    title: 'Trace AI upstream requests',
    steps: 'inspect_ai_upstream_logs -> inspect_ai_providers / inspect_ai_message_flow',
    description: 'Read redacted gonavi.log request records when the user needs upstream payloads, requestId, status codes, latency, or request body previews.',
  },
  {
    key: 'mcp_setup',
    title: 'Troubleshoot MCP access status',
    steps: 'inspect_mcp_setup -> inspect_mcp_runtime_failures -> inspect_ai_runtime',
    description: 'Confirm configured and enabled MCP services and external client write status, then use MCP runtime failure logs to explain missing tools.',
  },
  {
    key: 'remote_agent_mcp',
    title: 'Connect remote Agents to GoNavi MCP',
    steps: 'inspect_mcp_remote_access -> inspect_mcp_setup -> inspect_ai_safety',
    description: 'Use when OpenClaw/Hermans run on cloud Linux while database connections and passwords stay on the Windows GoNavi machine.',
  },
  {
    key: 'mcp_authoring',
    title: 'New MCP authoring guide',
    steps: 'inspect_mcp_authoring_guide -> inspect_mcp_draft -> inspect_mcp_setup',
    description: 'Read real field descriptions, templates, and full-command splitting rules before validating pasted commands or drafts.',
  },
  {
    key: 'docker_mcp',
    title: 'Troubleshoot Docker MCP startup',
    steps: 'inspect_mcp_runtime_failures -> inspect_mcp_docker_setup -> inspect_mcp_draft',
    description: 'Use when Docker README setup discovers 0 tools, containers exit immediately, or docker run arguments may be split incorrectly.',
  },
  {
    key: 'mcp_tool_parameters',
    title: 'Inspect MCP tool parameters',
    steps: 'inspect_mcp_setup -> inspect_mcp_tool_schema',
    description: 'Find the real discovered MCP tool alias first, then read inputSchema, required fields, enums, and nested parameter paths.',
  },
  {
    key: 'prompts_skills',
    title: 'Inspect current prompts and Skills',
    steps: 'inspect_ai_guidance -> inspect_ai_runtime',
    description: 'Confirm current custom prompts, enabled Skills, dependency tools, and effective scope before explaining current AI behavior.',
  },
  {
    key: 'ai_context',
    title: 'Inspect current AI context',
    steps: 'inspect_ai_context -> inspect_table_bundle / get_columns',
    description: 'Confirm which table structures are attached to the current conversation before field checks, table design review, or SQL generation.',
  },
  {
    key: 'current_connection',
    title: 'Inspect current connection',
    steps: 'inspect_current_connection -> get_databases / get_tables',
    description: 'Confirm the active data source type, address, current database, and SSH/proxy status before database exploration or connection troubleshooting.',
  },
  {
    key: 'connection_capabilities',
    title: 'Check data-source capability boundaries',
    steps: 'inspect_connection_capabilities -> inspect_current_connection',
    description: 'Check whether the current connection supports database creation/deletion, result editing, SQL export, or approximate counts.',
  },
  {
    key: 'saved_connections',
    title: 'Inventory local connection assets',
    steps: 'inspect_saved_connections -> inspect_current_connection / get_databases',
    description: 'Filter locally saved data sources by keyword or type, then inspect the chosen connection state or database structure.',
  },
  {
    key: 'redis_topology',
    title: 'Diagnose Redis topology',
    steps: 'inspect_redis_topology -> inspect_current_connection / inspect_app_logs',
    description: 'Use for Redis Sentinel, Cluster, multi-node, DB switch failures, or SSH tunnel issues to get status, redacted URI, adapter, DB semantics, and next actions.',
  },
  {
    key: 'external_sql_dirs',
    title: 'Inventory external SQL directories',
    steps: 'inspect_external_sql_directories -> inspect_workspace_tabs / inspect_active_tab',
    description: 'Confirm configured external SQL directories, their connection/database bindings, and where an opened SQL file comes from before analyzing scripts.',
  },
  {
    key: 'external_sql_file',
    title: 'Read external SQL files',
    steps: 'inspect_external_sql_directories -> inspect_external_sql_file -> inspect_active_tab',
    description: 'Locate a script path, read SQL file content from the directory, and combine it with the active tab draft if already opened.',
  },
  {
    key: 'active_tab',
    title: 'Read the current tab',
    steps: 'inspect_active_tab -> get_columns / get_indexes / execute_sql',
    description: 'Read the current editor SQL draft or table tab before field checks, index analysis, and read-only verification.',
  },
  {
    key: 'workspace_tabs',
    title: 'Inventory the current workspace',
    steps: 'inspect_workspace_tabs -> inspect_active_tab -> get_columns / execute_sql',
    description: 'See which SQL, table, or command tabs are open, then inspect the target tab for field checks, comparisons, and read-only validation.',
  },
  {
    key: 'shortcuts',
    title: 'Inspect current shortcut configuration',
    steps: 'inspect_shortcuts -> inspect_active_tab / inspect_workspace_tabs',
    description: 'Confirm current Win/Mac shortcuts, customizations, and how to trigger result panel, AI panel, query execution, and related actions.',
  },
  {
    key: 'recent_sql_logs',
    title: 'Review recent execution records',
    steps: 'inspect_recent_sql_logs -> get_columns / get_indexes / execute_sql',
    description: 'Trace recently failed SQL, slow query duration, or let AI explain and optimize based on real execution history.',
  },
  {
    key: 'recent_sql_activity',
    title: 'Summarize recent SQL activity',
    steps: 'inspect_recent_sql_activity -> inspect_recent_sql_logs -> inspect_current_connection',
    description: 'Check whether recent activity is mostly read or write, whether DDL or deletes occurred, and which database has the most recent errors.',
  },
  {
    key: 'sql_editor_transaction',
    title: 'Check SQL editor transactions',
    steps: 'inspect_sql_editor_transaction -> inspect_recent_sql_activity -> inspect_sql_risk',
    description: 'Confirm whether SQL editor DML enters a managed transaction, current commit mode, pending transactions, and commit semantics after update/insert/delete.',
  },
  {
    key: 'sql_risk',
    title: 'Pre-check SQL risk',
    steps: 'inspect_sql_risk -> inspect_ai_safety -> execute_sql',
    description: 'Before execution, deletion, update, DDL, or batch SQL, check statement count, write/DDL risk, WHERE clauses, and current safety policy.',
  },
  {
    key: 'app_logs',
    title: 'Troubleshoot application logs',
    steps: 'inspect_app_logs -> inspect_mcp_setup / inspect_saved_connections / inspect_current_connection',
    description: 'Review ERROR/WARN lines from the gonavi.log tail, then combine MCP, connection, and current data source state for diagnosis.',
  },
  {
    key: 'connection_failures',
    title: 'Troubleshoot connection failures and cooldown',
    steps: 'inspect_recent_connection_failures -> inspect_current_connection / inspect_saved_connections / inspect_app_logs',
    description: 'When connection failures, cooldown, or validation failures appear, get structured root cause, latest address, and next actions first.',
  },
  {
    key: 'render_error',
    title: 'Troubleshoot AI bubble render errors',
    steps: 'inspect_ai_last_render_error -> inspect_active_tab / inspect_ai_runtime',
    description: 'Use when an AI message is blank or a bubble fails locally while the panel stays alive; read the isolated render-error snapshot first.',
  },
  {
    key: 'message_flow',
    title: 'Diagnose AI message flow',
    steps: 'inspect_ai_message_flow -> inspect_ai_last_render_error / inspect_app_logs',
    description: 'Read the real current-session message structure and anomaly signals when replies split into bubbles, tool calls do not close, or flow state looks wrong.',
  },
  {
    key: 'context_budget',
    title: 'Diagnose AI context size',
    steps: 'inspect_ai_context_budget -> inspect_ai_context / inspect_ai_message_flow / inspect_ai_tool_catalog',
    description: 'When AI slows down, answers poorly, or context is too large, inspect messages, DDL, MCP schema, prompts, and Skills before narrowing context.',
  },
  {
    key: 'codebase_hotspots',
    title: 'Govern large frontend files',
    steps: 'inspect_codebase_hotspots -> inspect_ai_tool_catalog',
    description: 'Use before splitting thousand-line components, choosing the next refactor slice, or changing UI/AI/MCP code to inspect split hotspots, risk, and validation scope.',
  },
  {
    key: 'saved_queries',
    title: 'Reuse saved SQL',
    steps: 'inspect_saved_queries -> get_columns / execute_sql',
    description: 'Find locally saved query scripts first, then check fields and run read-only validation instead of rewriting old SQL manually.',
  },
  {
    key: 'ai_sessions',
    title: 'Review AI chat history',
    steps: 'inspect_ai_sessions -> inspect_active_tab / inspect_saved_queries',
    description: 'Locate previous AI sessions, first user questions, and recent replies before reusing the current tab or historical SQL context.',
  },
  {
    key: 'sql_snippets',
    title: 'Find SQL snippet templates',
    steps: 'inspect_sql_snippets',
    description: 'Find team SQL snippet templates, completion prefixes, and common skeletons before deciding whether to rewrite.',
  },
  {
    key: 'sample_data',
    title: 'Understand sample data',
    steps: 'get_columns -> preview_table_rows',
    description: 'Confirm fields first, then inspect the first real sample rows and null patterns.',
  },
  {
    key: 'readonly_validation',
    title: 'Read-only validation',
    steps: 'get_columns -> preview_table_rows -> execute_sql',
    description: 'After generating SQL, validate results on a small scope while still respecting the AI safety level.',
  },
];

export const localizeBuiltinToolFlows = (
  t?: BuiltinToolFlowTranslator,
): AIBuiltinToolFlow[] =>
  BUILTIN_TOOL_FLOW_COPY.map((flow) => {
    const keyPrefix = `${BUILTIN_TOOL_FLOW_KEY_PREFIX}.${flow.key}`;
    return {
      title: translateBuiltinToolFlow(t, `${keyPrefix}.title`, flow.title),
      steps: flow.steps,
      description: translateBuiltinToolFlow(t, `${keyPrefix}.description`, flow.description),
    };
  });

export const BUILTIN_TOOL_FLOWS: AIBuiltinToolFlow[] = localizeBuiltinToolFlows();

const stringifyHintValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const readTypeLabel = (schema: Record<string, any>): string => {
  if (Array.isArray(schema.type)) {
    return schema.type.map((item) => String(item)).filter(Boolean).join(' | ') || 'any';
  }
  if (typeof schema.type === 'string' && schema.type.trim()) {
    return schema.type.trim();
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return 'enum';
  }
  return 'any';
};

const readDefaultValue = (schema: Record<string, any>, description: string): string => {
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    return stringifyHintValue(schema.default);
  }
  const match = description.match(/\u9ed8\u8ba4\s*([^\s\uff0c,；;\u3002)\uff09]+)/u);
  return match?.[1]?.trim() || '';
};

const readExampleValue = (description: string): string => {
  const match = description.match(/(?:\u4f8b\u5982|\u793a\u4f8b\u503c?[:\uff1a])\s*([^\u3002；;\n]+)/u);
  return match?.[1]?.trim() || '';
};

export const describeBuiltinToolParameters = (tool: AIBuiltinToolInfo): AIBuiltinToolParameterHint[] => {
  const schema = tool.tool.function.parameters;
  const properties = schema && typeof schema === 'object' && typeof schema.properties === 'object'
    ? schema.properties
    : {};
  const required = new Set(
    Array.isArray(schema?.required) ? schema.required.map((item) => String(item)) : [],
  );

  return Object.entries(properties).map(([name, config]) => {
    const normalized = config && typeof config === 'object' ? config as Record<string, any> : {};
    const description = typeof normalized.description === 'string' ? normalized.description : '';
    return {
      name,
      required: required.has(name),
      typeLabel: readTypeLabel(normalized),
      description,
      enumValues: Array.isArray(normalized.enum) ? normalized.enum.map((item) => String(item)) : [],
      defaultValue: readDefaultValue(normalized, description),
      exampleValue: readExampleValue(description),
    };
  });
};

export const normalizeBuiltinToolCatalogSearch = (value: string): string =>
  value.trim().toLowerCase();

const matchesCatalogSearch = (keyword: string, values: unknown[]): boolean =>
  !keyword || values.some((value) => String(value || '').toLowerCase().includes(keyword));

export const filterBuiltinToolFlows = (
  flows: AIBuiltinToolFlow[],
  searchText: string,
): AIBuiltinToolFlow[] => {
  const keyword = normalizeBuiltinToolCatalogSearch(searchText);
  return flows.filter((flow) => matchesCatalogSearch(keyword, [
    flow.title,
    flow.steps,
    flow.description,
  ]));
};

export const filterBuiltinTools = (
  tools: AIBuiltinToolInfo[],
  searchText: string,
): AIBuiltinToolInfo[] => {
  const keyword = normalizeBuiltinToolCatalogSearch(searchText);
  return tools.filter((tool) => {
    const parameterDetails = describeBuiltinToolParameters(tool);
    return matchesCatalogSearch(keyword, [
      tool.name,
      tool.desc,
      tool.detail,
      tool.params,
      ...parameterDetails.flatMap((item) => [
        item.name,
        item.typeLabel,
        item.description,
        item.defaultValue,
        item.exampleValue,
        item.enumValues.join(' '),
      ]),
    ]);
  });
};
