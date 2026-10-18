import React from 'react';
import { t } from '../../i18n';
import { GnClaudeIcon, GnFolderIcon, GnOpenAIAgentIcon } from '../icons/gnIcons';
import { agentTreeNodeKey } from '../../utils/agentConnectionTypes';
import type { AgentIntegrationSummaryView } from '../../utils/agentConnectionTypes';
import type { SidebarTreeNode as TreeNode } from './sidebarV2TreeNodes';

/**
 * 智能体工具节点的品牌图标：复用文件夹图标的树图标槽位钩子类，
 * v2 主题的 20px 槽位规则自动生效。
 */
const agentKindIcon = (kind: string): React.ReactNode => {
  const Icon = kind === 'codex' ? GnOpenAIAgentIcon : kind === 'claude' ? GnClaudeIcon : null;
  if (!Icon) return null;
  return (
    <span className="gn-v2-tree-folder-icon" data-sidebar-tree-folder-icon="true">
      <Icon />
    </span>
  );
};

/**
 * 主页固定"智能体"系统分组：不可改名、删除或混入数据库分组（S-03）。
 * 首次成功启用后才出现；每种工具一个节点，不按 provider/项目拆分。
 */
export const buildAgentRootTreeNode = (
  integrations: AgentIntegrationSummaryView[],
): TreeNode | null => {
  const enabled = (integrations || []).filter((item) => !!item?.integrationId);
  if (enabled.length === 0) {
    return null;
  }
  return {
    title: t('sidebar.group.agents'),
    key: 'agent-root',
    type: 'agent-root',
    selectable: false,
    isLeaf: false,
    icon: (
      <span className="gn-v2-tree-folder-icon" data-sidebar-tree-folder-icon="true">
        <GnFolderIcon />
      </span>
    ),
    children: enabled.map((integration) => ({
      title: integration.displayName || integration.kind,
      key: agentTreeNodeKey(integration.integrationId),
      type: 'agent-integration',
      isLeaf: true,
      selectable: true,
      icon: agentKindIcon(integration.kind),
      dataRef: integration,
    })),
  } as TreeNode;
};
