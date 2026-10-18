/**
 * 智能体连接类型工具。会话浏览是纯只读的：类型键用于侧边栏智能体分组
 * 的工具节点，新增工具在此扩展。
 */

/** 主页固定"智能体"分组下，一个工具节点的树键。 */
export const agentTreeNodeKey = (integrationId: string): string =>
  `agent-integration-${integrationId}`;

/** 主页智能体分组节点的工具摘要（对应后端 SessionAgentProviders）。 */
export interface AgentIntegrationSummaryView {
  integrationId: string;
  kind: string;
  displayName: string;
  enabled: boolean;
  assetCount: number;
}
