import type { AIBuiltinToolInfo } from "./aiBuiltinToolInfo.types";

type InspectionToolInfoTranslator = (key: string) => string;

const MCP_TOOL_INFO_KEY_PREFIX = "ai_chat.inspection.tool_info";

const translateToolInfo = (
  t: InspectionToolInfoTranslator | undefined,
  key: string,
  fallback: string,
): string => {
  if (!t) return fallback;
  const translated = t(key);
  return translated && translated !== key ? translated : fallback;
};

const MCP_TOOL_INFO_COPY: Record<
  string,
  {
    icon: string;
    desc: string;
    detail: string;
    paramsSummary: string;
    toolDescription: string;
    params?: Record<string, string>;
  }
> = {
  inspect_mcp_setup: {
    icon: "🪛",
    desc: "Inspect current MCP configuration and external access",
    detail:
      "Returns the local MCP services, enabled state, declared startup commands, Claude Code / Codex / OpenCode local client write status, OpenClaw / Hermans remote Agent boundaries, and command detection results. Use it first when the user asks which MCP services are configured, why external clients cannot use them, or whether MCP was written into client configs.",
    paramsSummary: "No parameters",
    toolDescription:
      "Read the current local MCP configuration snapshot, including MCP service list, enabled state, startup commands, environment variable keys, discovered tools, external client GoNavi MCP write status, local CLI detection results, and remote Agent access boundaries. Use it when the user mentions MCP service configuration, Claude/Codex/OpenCode/OpenClaw/Hermans access, external clients not working, or which MCP services are enabled.",
  },
  inspect_mcp_remote_access: {
    icon: "🌉",
    desc: "Inspect OpenClaw/Hermans remote MCP access",
    detail:
      "Returns GoNavi Streamable HTTP MCP local startup commands, remote URL and authentication guidance, OpenClaw/Hermans cloud Agent access boundaries, optional bridging approaches, and safety reminders. Use it when the user asks how cloud OpenClaw connects to Windows GoNavi, how to keep database passwords away from Agents, or how to expose HTTP MCP.",
    paramsSummary: "publicUrl?, localAddr?, path?, exposeStrategy?, tokenConfigured?",
    toolDescription:
      "Read the GoNavi MCP remote Agent access snapshot, including Streamable HTTP mode startup commands, /mcp URL, Bearer Token authentication requirements, OpenClaw/Hermans cloud access steps, the boundary that keeps database passwords on the Windows host, and risk reminders for tunnel, reverse proxy, Tailscale, or other exposure strategies.",
    params: {
      publicUrl: "Optional. HTTPS or private-network URL reachable by the remote Agent. If /mcp is missing, the tool appends the configured path.",
      localAddr: "Optional. Windows local HTTP MCP listen address. Default 127.0.0.1:8765. Binding directly to 0.0.0.0 is not recommended.",
      path: "Optional. Streamable HTTP MCP path. Default /mcp.",
      exposeStrategy: "Optional. Planned remote exposure strategy used to return matching risk reminders.",
      tokenConfigured: "Optional. Whether a random Bearer Token is already configured. Passing false returns an authentication warning.",
    },
  },
  inspect_mcp_runtime_failures: {
    icon: "🧯",
    desc: "Diagnose MCP startup and tool-call failures",
    detail:
      "Reads recent MCP startup, tool discovery, tool-call, and HTTP MCP subprocess failures from gonavi.log, combines them with saved MCP services and discovered tools, and returns failure types, likely causes, involved services, and next repair actions. Use it first when users report failed MCP tests, 0 discovered tools, MCP tool-call failures, or HTTP MCP startup failures.",
    paramsSummary: "serverName?, keyword?, lineLimit?(default 160), includeLines?(default false)",
    toolDescription:
      "Read MCP runtime failure signals from GoNavi application logs, classify MCP service startup failures, tool discovery failures, tool-call failures, and HTTP MCP subprocess exits, then combine current MCP service configuration and discovered tool counts to return likely causes and nextActions.",
    params: {
      serverName: "Optional. Inspect only one MCP service name or server= name from logs, such as GitHub, Browser, or DockerFetch.",
      keyword: "Optional. Filter MCP-related logs by keyword, such as timeout, stdio, permission, 401, or docker.",
      lineLimit: "Optional. Maximum number of tail log lines to read. Default 160, maximum 200.",
      includeLines: "Optional. Whether to include redacted raw MCP log lines. Default false; enable only when original lines need to be quoted.",
    },
  },
  inspect_mcp_authoring_guide: {
    icon: "🧭",
    desc: "Inspect the add-MCP authoring guide",
    detail:
      "Returns the purpose of each add-MCP form field, recommended filling order, full-command auto-splitting rules, and npx / Node / uvx / Python / Docker / EXE templates. Use it before answering questions about command, args, env, templates, or why a full startup command should not be pasted into one field.",
    paramsSummary: "No parameters",
    toolDescription:
      "Read GoNavi's current built-in MCP authoring guide, including recommended field order, field purpose, common command examples, full-command auto-splitting rules, and npx / Node / uvx / Python / Docker / EXE template examples.",
  },
  inspect_mcp_docker_setup: {
    icon: "🐳",
    desc: "Inspect Docker MCP startup configuration",
    detail:
      "Reads saved Docker MCP services, checks whether command and args are split into docker, run, --rm, -i, image name, and container arguments correctly, then returns missing arguments, discovered tool count, timeout advice, and next repair actions. Use it when Docker README setup discovers 0 tools, the container exits immediately, or docker run arguments may be filled incorrectly.",
    paramsSummary: "serverId?, includeDisabled?(default true)",
    toolDescription:
      "Inspect startup arguments for saved Docker MCP services and return docker run/-i/image/--rm/env/timeout status, discovered tool counts, configuration warnings, and nextActions. Use it before guiding users through Docker MCP repairs.",
    params: {
      serverId: "Optional. Inspect only one MCP serverId. If omitted, all Docker MCP services are inspected.",
      includeDisabled: "Optional. Whether to include disabled Docker MCP services. Default true.",
    },
  },
  inspect_mcp_draft: {
    icon: "🧪",
    desc: "Validate an add-MCP draft",
    detail:
      "Simulates GoNavi add-MCP configuration from a full startup command or per-field draft, returning auto-split results, startup preview, applicable draft, command argument hints, environment variable hints, validation issues, recommended templates, and next repair suggestions. Sensitive values in command arguments are redacted.",
    paramsSummary: "fullCommand?, command?, args?, envText?, timeoutSeconds?, templateKey?, name?",
    toolDescription:
      "Validate a pending MCP service draft. Supports fullCommand/rawCommand/commandLine for automatic splitting, or command, args, envText, timeoutSeconds, and templateKey for per-field validation. Returns parsed fields, redacted startup preview, suggestedServerSeed, command argument hints, environment variable key purpose and risk hints, errors, warnings, recommended templates, and nextActions without echoing api-key/token/password values.",
    params: {
      fullCommand: "Optional. A full MCP startup command from README or the user, such as $env:GITHUB_TOKEN=...; uvx mcp-server-github --stdio.",
      command: "Optional. Startup command in a per-field draft. It should be only npx, node, uvx, python, or an exe path.",
      args: "Optional. Command arguments in a per-field draft. Arrays are more accurate, but comma-separated or newline-separated strings are also accepted.",
      envText: "Optional. Environment variable draft, one KEY=VALUE per line. Do not pass export, set, or $env: prefixes.",
      timeoutSeconds: "Optional. Timeout seconds for one tool discovery or call. Recommended 20; slow-start services can use 45 or 60.",
      templateKey: "Optional. Apply a built-in template first, then override it with user-supplied fields.",
      name: "Optional. MCP service name, such as GitHub, Filesystem, or Browser.",
    },
  },
  inspect_mcp_tool_schema: {
    icon: "🧩",
    desc: "Inspect MCP tool argument schema",
    detail:
      "Reads the inputSchema for currently discovered MCP tools by alias, serverId, or keyword, returning required parameters, field types, enum values, nested object paths, and pre-call hints. Use it after MCP discovery succeeds when a user or AI needs to know what arguments an MCP tool accepts.",
    paramsSummary: "alias?, serverId?, keyword?, includeSchema?(default false), limit?(default 8)",
    toolDescription:
      "Read parameter schema summaries for currently discovered MCP tools, filterable by alias, serverId, or keyword, and return required fields, types, enum values, nested parameter paths, and pre-call hints. Use it before writing arguments JSON for external MCP tool calls or after parameter-related tool-call errors.",
    params: {
      alias: "Optional. Query by exact MCP tool alias, such as github_create_issue. Prefer reading the real alias from inspect_mcp_setup first.",
      serverId: "Optional. Only inspect tools discovered under one MCP serverId.",
      keyword: "Optional. Filter by tool alias, original name, title, description, or service name.",
      includeSchema: "Optional. Whether to include the full raw inputSchema. Default false; enable only for complex nested schema inspection.",
      limit: "Optional. Maximum number of matching tools to return. Default 8, maximum 30.",
    },
  },
};

const createMcpToolInfo = (
  name: keyof typeof MCP_TOOL_INFO_COPY,
  properties: Record<string, any> = {},
  parameterExtras: Record<string, any> = {},
): AIBuiltinToolInfo => {
  const copy = MCP_TOOL_INFO_COPY[name];
  const translatedProperties = Object.fromEntries(
    Object.entries(properties).map(([paramName, schema]) => [
      paramName,
      {
        ...schema,
        description: copy.params?.[paramName],
      },
    ]),
  );

  return {
    name,
    icon: copy.icon,
    desc: copy.desc,
    detail: copy.detail,
    params: copy.paramsSummary,
    tool: {
      type: "function",
      function: {
        name,
        description: copy.toolDescription,
        parameters: {
          type: "object",
          properties: translatedProperties,
          ...parameterExtras,
        },
      },
    },
  };
};

export const BUILTIN_AI_INSPECTION_MCP_TOOL_INFO: AIBuiltinToolInfo[] = [
  createMcpToolInfo("inspect_mcp_setup"),
  createMcpToolInfo("inspect_mcp_remote_access", {
    publicUrl: { type: "string" },
    localAddr: { type: "string" },
    path: { type: "string" },
    exposeStrategy: {
      type: "string",
      enum: ["reverse_proxy", "ssh_reverse_tunnel", "cloudflare_tunnel", "tailscale", "custom"],
    },
    tokenConfigured: { type: "boolean" },
  }),
  createMcpToolInfo("inspect_mcp_runtime_failures", {
    serverName: { type: "string" },
    keyword: { type: "string" },
    lineLimit: { type: "number" },
    includeLines: { type: "boolean" },
  }),
  createMcpToolInfo("inspect_mcp_authoring_guide"),
  createMcpToolInfo("inspect_mcp_docker_setup", {
    serverId: { type: "string" },
    includeDisabled: { type: "boolean" },
  }),
  createMcpToolInfo("inspect_mcp_draft", {
    fullCommand: { type: "string" },
    command: { type: "string" },
    args: {
      oneOf: [
        { type: "array", items: { type: "string" } },
        { type: "string" },
      ],
    },
    envText: { type: "string" },
    timeoutSeconds: { type: "number" },
    templateKey: { type: "string", enum: ["npx", "uvx", "node", "python", "docker", "exe"] },
    name: { type: "string" },
  }),
  createMcpToolInfo("inspect_mcp_tool_schema", {
    alias: { type: "string" },
    serverId: { type: "string" },
    keyword: { type: "string" },
    includeSchema: { type: "boolean" },
    limit: { type: "number" },
  }),
];

export const localizeBuiltinInspectionMcpToolInfo = (
  t?: InspectionToolInfoTranslator,
): AIBuiltinToolInfo[] =>
  BUILTIN_AI_INSPECTION_MCP_TOOL_INFO.map((tool) => {
    const copy = MCP_TOOL_INFO_COPY[tool.name];
    if (!copy) return tool;

    const keyPrefix = `${MCP_TOOL_INFO_KEY_PREFIX}.${tool.name}`;
    const originalProperties = tool.tool.function.parameters?.properties || {};
    const translatedProperties = Object.fromEntries(
      Object.entries(originalProperties).map(([paramName, schema]) => {
        const fallback = copy.params?.[paramName];
        if (!fallback || !schema || typeof schema !== "object") {
          return [paramName, schema];
        }
        return [
          paramName,
          {
            ...schema,
            description: translateToolInfo(t, `${keyPrefix}.param.${paramName}`, fallback),
          },
        ];
      }),
    );

    return {
      ...tool,
      desc: translateToolInfo(t, `${keyPrefix}.desc`, copy.desc),
      detail: translateToolInfo(t, `${keyPrefix}.detail`, copy.detail),
      params: translateToolInfo(t, `${keyPrefix}.params`, copy.paramsSummary),
      tool: {
        ...tool.tool,
        function: {
          ...tool.tool.function,
          description: translateToolInfo(t, `${keyPrefix}.tool_description`, copy.toolDescription),
          parameters: {
            ...tool.tool.function.parameters,
            properties: translatedProperties,
          },
        },
      },
    };
  });
