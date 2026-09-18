import type { AIMCPClientInstallStatus } from '../../types';
import {
  buildRemoteMCPClientGuide,
  isRemoteMCPClientStatus,
  normalizeMCPClientStatuses,
} from '../../utils/mcpClientInstallStatus';
import type { AIInspectionTranslator } from './aiInspectionI18n';
import { translateInspectionCopy } from './aiInspectionI18n';

type MCPRemoteExposeStrategyKey =
  | 'reverse_proxy'
  | 'ssh_reverse_tunnel'
  | 'cloudflare_tunnel'
  | 'tailscale'
  | 'custom';

const DEFAULT_HTTP_ADDR = '127.0.0.1:8765';
const DEFAULT_HTTP_PATH = '/mcp';
const TOKEN_PLACEHOLDER = '<random-token>';

const REMOTE_EXPOSE_STRATEGIES: Array<{
  key: MCPRemoteExposeStrategyKey;
}> = [
  {
    key: 'reverse_proxy',
  },
  {
    key: 'ssh_reverse_tunnel',
  },
  {
    key: 'cloudflare_tunnel',
  },
  {
    key: 'tailscale',
  },
  {
    key: 'custom',
  },
];

const MCP_REMOTE_STRATEGY_FALLBACKS: Record<MCPRemoteExposeStrategyKey, {
  title: string;
  detail: string;
  risk: string;
}> = {
  reverse_proxy: {
    title: 'Internal reverse proxy',
    detail: 'Use this when Windows GoNavi and the cloud Agent already share a trusted intranet or gateway.',
    risk: 'Keep source IP, TLS, and Bearer Token restrictions at the gateway; do not expose it directly to the public internet.',
  },
  ssh_reverse_tunnel: {
    title: 'SSH reverse tunnel',
    detail: 'Use this to temporarily map Windows 127.0.0.1:8765 to cloud Linux. It is simple, but the SSH account and port must be controlled.',
    risk: 'The cloud Agent becomes unavailable if the tunnel disconnects, so this fits PoC or controlled operations environments.',
  },
  cloudflare_tunnel: {
    title: 'Cloudflare Tunnel',
    detail: 'Use this for Windows machines without a fixed public entry point, with Cloudflare Access layered for identity checks.',
    risk: 'Access / Zero Trust rules must be enabled; do not rely only on a random URL.',
  },
  tailscale: {
    title: 'Tailscale / WireGuard',
    detail: 'Use this when Windows GoNavi and the cloud Agent can join the same private network and prefer an intranet address.',
    risk: 'Control ACLs so only the target Agent can reach the GoNavi MCP port.',
  },
  custom: {
    title: 'Custom bridge',
    detail: 'Use this when an enterprise gateway, bastion host, or dedicated MCP gateway already exists.',
    risk: 'Define TLS, authentication, audit, and source restrictions clearly to avoid exposing local database capabilities to unknown Agents.',
  },
};

const translateMCPRemoteCopy = (
  translate: AIInspectionTranslator | undefined,
  key: string,
  fallback: string,
  params?: Parameters<AIInspectionTranslator>[1],
): string => translateInspectionCopy(translate, key, fallback, params);

const normalizePath = (value: unknown): string => {
  const raw = String(value || DEFAULT_HTTP_PATH).trim();
  if (!raw) {
    return DEFAULT_HTTP_PATH;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
};

const normalizeLocalAddr = (value: unknown): string => {
  const raw = String(value || DEFAULT_HTTP_ADDR).trim();
  return raw || DEFAULT_HTTP_ADDR;
};

const normalizePublicUrl = (value: unknown, path: string): string => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const normalizedPath = normalizePath(path);
  const withoutTrailingSlash = raw.replace(/\/+$/u, '');
  return withoutTrailingSlash.endsWith(normalizedPath)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}${normalizedPath}`;
};

const buildHttpLaunchCommand = (binary: string, addr: string, path: string): string =>
  `${binary} mcp-server http --addr ${addr} --path ${path} --token ${TOKEN_PLACEHOLDER}`;

const buildStandaloneLaunchCommand = (addr: string, path: string): string =>
  `gonavi-mcp-server http --addr ${addr} --path ${path} --token ${TOKEN_PLACEHOLDER}`;

const resolveStrategy = (value: unknown) => {
  const key = String(value || '').trim() as MCPRemoteExposeStrategyKey;
  return REMOTE_EXPOSE_STRATEGIES.find((item) => item.key === key) || REMOTE_EXPOSE_STRATEGIES[0];
};

const translateStrategy = (
  strategy: { key: MCPRemoteExposeStrategyKey },
  translate: AIInspectionTranslator | undefined,
) => {
  const fallback = MCP_REMOTE_STRATEGY_FALLBACKS[strategy.key];
  return {
    ...strategy,
    title: translateMCPRemoteCopy(
      translate,
      `ai_chat.inspection.mcp_remote.strategy.${strategy.key}.title`,
      fallback.title,
    ),
    detail: translateMCPRemoteCopy(
      translate,
      `ai_chat.inspection.mcp_remote.strategy.${strategy.key}.detail`,
      fallback.detail,
    ),
    risk: translateMCPRemoteCopy(
      translate,
      `ai_chat.inspection.mcp_remote.strategy.${strategy.key}.risk`,
      fallback.risk,
    ),
  };
};

export const buildMCPRemoteAccessSnapshot = (params: {
  mcpClientStatuses?: AIMCPClientInstallStatus[];
  publicUrl?: string;
  localAddr?: string;
  path?: string;
  exposeStrategy?: MCPRemoteExposeStrategyKey | string;
  tokenConfigured?: boolean;
  translate?: AIInspectionTranslator;
} = {}) => {
  const { translate } = params;
  const localAddr = normalizeLocalAddr(params.localAddr);
  const path = normalizePath(params.path);
  const localUrl = `http://${localAddr}${path}`;
  const publicUrl = normalizePublicUrl(params.publicUrl, path);
  const selectedStrategy = resolveStrategy(params.exposeStrategy);
  const clientStatuses = normalizeMCPClientStatuses(params.mcpClientStatuses);
  const remoteClients = clientStatuses
    .filter(isRemoteMCPClientStatus)
    .map((status) => ({
      client: status.client,
      displayName: status.displayName,
      installMode: status.installMode || 'remote',
      message: status.message || '',
      guide: buildRemoteMCPClientGuide(status, translate),
    }));

  const warnings: string[] = [];
  const nextActions: string[] = [
    translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.next_action.start_local_http',
      'Start GoNavi MCP HTTP mode on Windows and confirm /healthz is reachable.',
    ),
    translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.next_action.expose_mcp_only',
      'Expose only /mcp to the target cloud Agent through a tunnel, reverse proxy, or private network.',
    ),
    translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.next_action.configure_agent',
      'Configure Streamable HTTP MCP URL and Authorization Bearer Token in OpenClaw/Hermans.',
    ),
    translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.next_action.inspect_connections',
      'Call get_connections first to obtain connectionId, then call get_server_version and read schemas; do not copy database passwords to the cloud Agent.',
    ),
  ];

  if (!publicUrl) {
    warnings.push(translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.warning.missing_public_url',
      'No MCP URL reachable by the cloud Agent was provided; a remote Agent cannot directly access Windows local 127.0.0.1.',
    ));
  } else if (!/^https:\/\//iu.test(publicUrl) && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/iu.test(publicUrl)) {
    warnings.push(translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.warning.non_https_public_url',
      'The remote MCP URL is not HTTPS; if it is not a private network address, add TLS or place it behind a controlled tunnel.',
    ));
  }

  if (params.tokenConfigured === false) {
    warnings.push(translateMCPRemoteCopy(
      translate,
      'ai_chat.inspection.mcp_remote.warning.missing_token',
      'Bearer Token readiness is not confirmed; HTTP MCP must use a random token and must not be exposed without authentication.',
    ));
  }

  return {
    mode: 'streamable-http',
    message: publicUrl
      ? translateMCPRemoteCopy(
          translate,
          'ai_chat.inspection.mcp_remote.message.with_public_url',
          'The remote Agent should access GoNavi MCP through {{publicUrl}} and authenticate with Bearer Token',
          { publicUrl },
        )
      : translateMCPRemoteCopy(
          translate,
          'ai_chat.inspection.mcp_remote.message.no_public_url',
          'The remote Agent needs to access the Windows GoNavi MCP HTTP endpoint through a controlled tunnel or reverse proxy',
        ),
    endpoint: {
      localAddr,
      path,
      localUrl,
      publicUrl,
      healthCheckPath: '/healthz',
      authHeader: `Authorization: Bearer ${TOKEN_PLACEHOLDER}`,
    },
    launchCommands: {
      appBinary: buildHttpLaunchCommand('GoNavi.exe', localAddr, path),
      standaloneBinary: buildStandaloneLaunchCommand(localAddr, path),
      tokenEnvFallback: `GONAVI_MCP_HTTP_TOKEN=${TOKEN_PLACEHOLDER} gonavi-mcp-server http --addr 127.0.0.1:8765 --path /mcp`,
    },
    selectedStrategy: translateStrategy(selectedStrategy, translate),
    exposeStrategies: REMOTE_EXPOSE_STRATEGIES.map((strategy) => translateStrategy(strategy, translate)),
    remoteClients,
    securityBoundary: {
      databaseSecretsStayLocal: true,
      cloudAgentNeedsDatabasePassword: false,
      httpBearerTokenRequired: true,
      executeSqlStillRequiresAISafetyPolicy: true,
      mutatingSqlStillRequiresAllowMutating: true,
      recommendedBindAddress: translateMCPRemoteCopy(
        translate,
        'ai_chat.inspection.mcp_remote.security.recommended_bind_address',
        '127.0.0.1 unless a controlled gateway or private network is in front',
      ),
    },
    warnings,
    nextActions,
  };
};
