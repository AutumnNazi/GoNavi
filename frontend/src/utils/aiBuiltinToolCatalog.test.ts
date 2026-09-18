import { describe, expect, it } from 'vitest';

import {
  BUILTIN_TOOL_FLOWS,
  describeBuiltinToolParameters,
  filterBuiltinToolFlows,
  filterBuiltinTools,
  localizeBuiltinToolFlows,
} from './aiBuiltinToolCatalog';
import type { AIBuiltinToolInfo } from './aiBuiltinToolInfo.types';
import { BUILTIN_AI_TOOL_INFO, localizeBuiltinAIToolInfo } from './aiToolRegistry';

describe('describeBuiltinToolParameters', () => {
  it('extracts type, required, enum, default, and example hints from builtin tool schemas', () => {
    const tool: AIBuiltinToolInfo = {
      name: 'inspect_demo',
      icon: '🧪',
      desc: '测试工具',
      detail: '用于测试参数提示提取。',
      params: 'lineLimit?, mode?, serverName?',
      tool: {
        type: 'function',
        function: {
          name: 'inspect_demo',
          description: '测试工具',
          parameters: {
            type: 'object',
            required: ['mode'],
            properties: {
              lineLimit: { type: 'number', description: '可选，最多读取多少行，默认 160，最大 200' },
              mode: { type: 'string', enum: ['fast', 'safe'], default: 'safe', description: '运行模式' },
              serverName: { type: 'string', description: '可选，例如 GitHub、Browser、DockerFetch' },
              includeDisabled: { type: ['boolean', 'null'], description: '是否包含禁用项，默认 false' },
            },
          },
        },
      },
    };

    expect(describeBuiltinToolParameters(tool)).toEqual([
      {
        name: 'lineLimit',
        required: false,
        typeLabel: 'number',
        description: '可选，最多读取多少行，默认 160，最大 200',
        enumValues: [],
        defaultValue: '160',
        exampleValue: '',
      },
      {
        name: 'mode',
        required: true,
        typeLabel: 'string',
        description: '运行模式',
        enumValues: ['fast', 'safe'],
        defaultValue: 'safe',
        exampleValue: '',
      },
      {
        name: 'serverName',
        required: false,
        typeLabel: 'string',
        description: '可选，例如 GitHub、Browser、DockerFetch',
        enumValues: [],
        defaultValue: '',
        exampleValue: 'GitHub、Browser、DockerFetch',
      },
      {
        name: 'includeDisabled',
        required: false,
        typeLabel: 'boolean | null',
        description: '是否包含禁用项，默认 false',
        enumValues: [],
        defaultValue: 'false',
        exampleValue: '',
      },
    ]);
  });

  it('filters flows and tools by parameter names and descriptions', () => {
    const allowMutatingTools = filterBuiltinTools(BUILTIN_AI_TOOL_INFO, 'allowMutating')
      .map((tool) => tool.name);
    expect(allowMutatingTools).toContain('inspect_ai_safety');
    expect(allowMutatingTools).not.toContain('inspect_mcp_runtime_failures');

    const executeSqlTools = filterBuiltinTools(BUILTIN_AI_TOOL_INFO, 'SQL statement to execute')
      .map((tool) => tool.name);
    expect(executeSqlTools).toContain('execute_sql');

    const mcpFlows = filterBuiltinToolFlows(BUILTIN_TOOL_FLOWS, 'runtime failure logs')
      .map((flow) => flow.title);
    expect(mcpFlows).toContain('Troubleshoot MCP access status');

    const codebaseFlows = filterBuiltinToolFlows(BUILTIN_TOOL_FLOWS, 'split hotspots')
      .map((flow) => flow.title);
    expect(codebaseFlows).toContain('Govern large frontend files');
  });

  it('localizes builtin tool flows while preserving raw tool-call steps', () => {
    const translations: Record<string, string> = {
      'ai_chat.builtin_tools.flows.locate_table_fields.title': 'Locate tables and fields',
      'ai_chat.builtin_tools.flows.locate_table_fields.description': 'Find the connection, database, and table first, then confirm fields before writing SQL.',
    };
    const t = (key: string) => translations[key] || `missing:${key}`;

    const [flow] = localizeBuiltinToolFlows(t);

    expect(flow.title).toBe('Locate tables and fields');
    expect(flow.steps).toBe('get_connections -> get_server_version -> get_databases -> get_tables -> get_columns');
    expect(flow.description).toContain('writing SQL');
  });

  it('localizes database builtin tool copy while preserving raw tool and parameter names', () => {
    const translations: Record<string, string> = {
      'ai_chat.builtin_tools.database.execute_sql.desc': 'Execute a SQL query and return results',
      'ai_chat.builtin_tools.database.execute_sql.detail': 'Runs SQL on the target database; read-only mode only allows SELECT/SHOW/DESCRIBE.',
      'ai_chat.builtin_tools.database.execute_sql.params': 'connectionId, dbName, sql',
      'ai_chat.builtin_tools.database.execute_sql.tool_description': 'Run SQL on the selected connection and database. SELECT/SHOW/DESCRIBE stay raw.',
      'ai_chat.builtin_tools.database.execute_sql.parameters.connectionId.description': 'Connection ID',
      'ai_chat.builtin_tools.database.execute_sql.parameters.dbName.description': 'Database name',
      'ai_chat.builtin_tools.database.execute_sql.parameters.sql.description': 'SQL statement to execute',
    };
    const t = (key: string) => translations[key] || `missing:${key}`;

    const executeSql = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'execute_sql');

    expect(executeSql?.name).toBe('execute_sql');
    expect(executeSql?.desc).toBe('Execute a SQL query and return results');
    expect(executeSql?.detail).toContain('SELECT/SHOW/DESCRIBE');
    expect(executeSql?.params).toBe('connectionId, dbName, sql');
    expect(executeSql?.tool.function.name).toBe('execute_sql');
    expect(executeSql?.tool.function.description).toContain('SELECT/SHOW/DESCRIBE');
    expect(Object.keys(executeSql?.tool.function.parameters.properties || {})).toEqual([
      'connectionId',
      'dbName',
      'sql',
    ]);
    expect(executeSql?.tool.function.parameters.properties.sql.description).toBe('SQL statement to execute');
  });

  it('localizes MCP inspection tool copy while preserving raw tool and parameter names', () => {
    const translations: Record<string, string> = {
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.desc': 'Inspect remote MCP access',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.detail': 'Returns GoNavi Streamable HTTP MCP access guidance for remote Agents.',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.params': 'publicUrl?, localAddr?, path?, exposeStrategy?, tokenConfigured?',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.tool_description': 'Read the GoNavi MCP remote Agent access snapshot.',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.param.publicUrl': 'Optional HTTPS or private-network URL reachable by the remote Agent.',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.param.localAddr': 'Optional local HTTP MCP listen address.',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.param.path': 'Optional Streamable HTTP MCP path.',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.param.exposeStrategy': 'Optional remote exposure strategy.',
      'ai_chat.inspection.tool_info.inspect_mcp_remote_access.param.tokenConfigured': 'Optional. Whether a random Bearer Token is already configured.',
    };
    const t = (key: string) => translations[key] || `missing:${key}`;

    const remoteAccess = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'inspect_mcp_remote_access');

    expect(remoteAccess?.name).toBe('inspect_mcp_remote_access');
    expect(remoteAccess?.desc).toBe('Inspect remote MCP access');
    expect(remoteAccess?.detail).toContain('Streamable HTTP MCP');
    expect(remoteAccess?.params).toBe('publicUrl?, localAddr?, path?, exposeStrategy?, tokenConfigured?');
    expect(remoteAccess?.tool.function.name).toBe('inspect_mcp_remote_access');
    expect(remoteAccess?.tool.function.description).toBe('Read the GoNavi MCP remote Agent access snapshot.');
    expect(Object.keys(remoteAccess?.tool.function.parameters.properties || {})).toEqual([
      'publicUrl',
      'localAddr',
      'path',
      'exposeStrategy',
      'tokenConfigured',
    ]);
    expect(remoteAccess?.tool.function.parameters.properties.publicUrl.description).toContain('remote Agent');
  });

  it('localizes diagnostics inspection tool copy while preserving raw tool and parameter names', () => {
    const translations: Record<string, string> = {
      'ai_chat.inspection.tool_info.inspect_app_logs.desc': 'Inspect GoNavi application logs',
      'ai_chat.inspection.tool_info.inspect_app_logs.detail': 'Reads recent GoNavi application log lines with optional keyword filtering.',
      'ai_chat.inspection.tool_info.inspect_app_logs.params': 'keyword?, lineLimit?(default 80)',
      'ai_chat.inspection.tool_info.inspect_app_logs.tool_description': 'Read recent GoNavi application logs before diagnosing startup or MCP failures.',
      'ai_chat.inspection.tool_info.inspect_app_logs.param.keyword': 'Optional keyword used to filter log content.',
      'ai_chat.inspection.tool_info.inspect_app_logs.param.lineLimit': 'Optional maximum number of log lines to return.',
    };
    const t = (key: string) => translations[key] || `missing:${key}`;

    const appLogs = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'inspect_app_logs');

    expect(appLogs?.name).toBe('inspect_app_logs');
    expect(appLogs?.desc).toBe('Inspect GoNavi application logs');
    expect(appLogs?.detail).toContain('keyword filtering');
    expect(appLogs?.params).toBe('keyword?, lineLimit?(default 80)');
    expect(appLogs?.tool.function.name).toBe('inspect_app_logs');
    expect(appLogs?.tool.function.description).toBe('Read recent GoNavi application logs before diagnosing startup or MCP failures.');
    expect(Object.keys(appLogs?.tool.function.parameters.properties || {})).toEqual([
      'keyword',
      'lineLimit',
    ]);
    expect(appLogs?.tool.function.parameters.properties.keyword.description).toBe('Optional keyword used to filter log content.');
  });

  it('localizes core and context inspection tool copy while preserving raw names', () => {
    const translations: Record<string, string> = {
      'ai_chat.inspection.tool_info.inspect_ai_runtime.desc': 'Inspect current AI runtime',
      'ai_chat.inspection.tool_info.inspect_ai_runtime.detail': 'Returns provider, model, safety level, enabled Skills, and available tools.',
      'ai_chat.inspection.tool_info.inspect_ai_runtime.params': 'No parameters',
      'ai_chat.inspection.tool_info.inspect_ai_runtime.tool_description': 'Read the current AI runtime snapshot before answering capability questions.',
      'ai_chat.inspection.tool_info.inspect_ai_safety.desc': 'Inspect AI write safety boundaries',
      'ai_chat.inspection.tool_info.inspect_ai_safety.detail': 'Returns SQL write boundaries and whether allowMutating is required.',
      'ai_chat.inspection.tool_info.inspect_ai_safety.params': 'No parameters',
      'ai_chat.inspection.tool_info.inspect_ai_safety.tool_description': 'Read the current AI safety boundary including allowMutating requirements.',
      'ai_chat.inspection.tool_info.inspect_current_connection.desc': 'Inspect the current connection',
      'ai_chat.inspection.tool_info.inspect_current_connection.detail': 'Returns the active data source, database, address, and SSH or proxy state.',
      'ai_chat.inspection.tool_info.inspect_current_connection.params': 'No parameters',
      'ai_chat.inspection.tool_info.inspect_current_connection.tool_description': 'Read the active connection summary before database exploration.',
      'ai_chat.inspection.tool_info.inspect_connection_capabilities.desc': 'Inspect data-source capabilities',
      'ai_chat.inspection.tool_info.inspect_connection_capabilities.detail': 'Returns capability flags for the current or specified connection.',
      'ai_chat.inspection.tool_info.inspect_connection_capabilities.params': 'connectionId?(default current active connection)',
      'ai_chat.inspection.tool_info.inspect_connection_capabilities.tool_description': 'Read the frontend capability matrix for a saved connection.',
      'ai_chat.inspection.tool_info.inspect_connection_capabilities.param.connectionId': 'Optional connection ID to inspect.',
    };
    const t = (key: string) => translations[key] || `missing:${key}`;

    const runtime = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'inspect_ai_runtime');
    const safety = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'inspect_ai_safety');
    const currentConnection = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'inspect_current_connection');
    const capabilities = localizeBuiltinAIToolInfo(t).find((tool) => tool.name === 'inspect_connection_capabilities');

    expect(runtime?.name).toBe('inspect_ai_runtime');
    expect(runtime?.desc).toBe('Inspect current AI runtime');
    expect(runtime?.tool.function.name).toBe('inspect_ai_runtime');
    expect(runtime?.tool.function.description).toBe('Read the current AI runtime snapshot before answering capability questions.');

    expect(safety?.desc).toBe('Inspect AI write safety boundaries');
    expect(safety?.detail).toContain('allowMutating');
    expect(safety?.tool.function.description).toContain('allowMutating');

    expect(currentConnection?.name).toBe('inspect_current_connection');
    expect(currentConnection?.desc).toBe('Inspect the current connection');
    expect(currentConnection?.detail).toContain('SSH');

    expect(capabilities?.params).toBe('connectionId?(default current active connection)');
    expect(Object.keys(capabilities?.tool.function.parameters.properties || {})).toEqual(['connectionId']);
    expect(capabilities?.tool.function.parameters.properties.connectionId.description).toBe('Optional connection ID to inspect.');
  });
});
