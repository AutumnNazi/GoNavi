/**
 * 智能体连接类型工具。首版仅 Codex（S-01）；类型键同时用于
 * 连接分类目录与智能体启用页，新增工具在此扩展。
 */
export const AGENT_CONNECTION_TYPES: readonly string[] = ['codex'];

const AGENT_CONNECTION_TYPE_SET = new Set(AGENT_CONNECTION_TYPES);

export const isAgentConnectionType = (type: unknown): boolean =>
  AGENT_CONNECTION_TYPE_SET.has(String(type || '').trim().toLowerCase());

/** 主页固定"智能体"分组下，一个工具节点的树键。 */
export const agentTreeNodeKey = (integrationId: string): string =>
  `agent-integration-${integrationId}`;

/** 主页智能体分组节点的集成摘要（对应后端 sessionassets.AgentIntegrationSummary）。 */
export interface AgentIntegrationSummaryView {
  integrationId: string;
  kind: string;
  displayName: string;
  enabled: boolean;
  assetCount: number;
}

/** 智能体检测/启用页的组合视图（对应后端 sessionassets.DetectionView）。 */
export interface AgentDetectionView {
  kind: string;
  detectionStatus: string;
  integrationStatus: string;
  commandPath: string;
  version: string;
  dataDir: string;
  dataReadable: boolean;
  materialsRoot: string;
  integrationId: string;
  details: string[];
}
