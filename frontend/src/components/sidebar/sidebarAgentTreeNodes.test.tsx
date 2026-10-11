import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { buildAgentRootTreeNode } from './sidebarAgentTreeNodes';

// 主页"智能体"分组的树节点构建：子节点必须带品牌图标，否则侧栏
// Codex 节点没有图标可显示（用户反馈缺陷回归）。

describe('buildAgentRootTreeNode', () => {
  it('returns null when no enabled integration exists', () => {
    expect(buildAgentRootTreeNode([])).toBeNull();
  });

  it('attaches the OpenAI brand icon to integration nodes', () => {
    const root = buildAgentRootTreeNode([
      { integrationId: 'int-1', kind: 'codex', displayName: 'ChatGPT', enabled: true, assetCount: 3 },
    ]);
    expect(root).toBeTruthy();
    const child = root?.children?.[0];
    expect(child).toBeTruthy();
    expect(child?.type).toBe('agent-integration');
    // 图标包在 v2 主题的树图标槽位钩子类里；内层是 GnOpenAIAgentIcon。
    const iconElement = child?.icon as ReactElement<{ className?: string; children?: ReactNode }> | null;
    expect(iconElement?.props?.className).toContain('gn-v2-tree-folder-icon');
    const inner = iconElement?.props?.children as ReactElement | undefined;
    expect((inner?.type as { displayName?: string })?.displayName).toBe('GnIcon(openai-agent)');
  });

  it('keeps integration nodes without an icon for unknown agent kinds', () => {
    const root = buildAgentRootTreeNode([
      { integrationId: 'int-2', kind: 'future-agent', displayName: 'Future', enabled: true, assetCount: 0 },
    ]);
    expect(root?.children?.[0]?.icon).toBeNull();
  });
});
