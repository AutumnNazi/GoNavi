import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { setCurrentLanguage, t } from '../i18n';
import { buildSidebarLegacyNodeMenuItems } from './sidebar/sidebarLegacyNodeMenu';
import { resolveV2ConnectionGroup, type V2RailConnectionGroup } from './sidebarV2Utils';
import { V2ConnectionGroupContextMenuView } from './V2TableContextMenu';

const readSource = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('Sidebar connection group new connection action', () => {
  it('opens the V2 group menu for any right-clicked group, including nested groups', () => {
    const productionGroup: V2RailConnectionGroup = {
      id: 'production',
      name: '生产环境',
      connections: [],
      rootToken: 'tag:production',
    };
    const rootGroup: V2RailConnectionGroup = {
      id: 'root',
      name: '全部环境',
      connections: [],
      children: [productionGroup],
      rootToken: 'tag:root',
    };

    expect(resolveV2ConnectionGroup({
      type: 'tag',
      dataRef: { id: 'production' },
    }, [rootGroup])).toBe(productionGroup);
  });

  it('renders the V2 group header, connection count, and new connection action', () => {
    setCurrentLanguage('zh-CN');
    const markup = renderToStaticMarkup(
      <V2ConnectionGroupContextMenuView groupName="生产环境" count={2} />,
    );

    expect(markup).toContain('生产环境');
    expect(markup).toContain(t('connection.sidebar.group.meta', { count: '2' }));
    expect(markup).toContain(t('connection.new'));
  });

  it('adds the shared new connection action for every group right-click', () => {
    const onCreateConnectionInGroup = vi.fn();
    const node = {
      key: 'tag-production',
      type: 'tag',
      title: '生产环境',
      dataRef: {
        id: 'production',
        parentTagId: null,
        connectionIds: [],
      },
    };
    const context = {
      createTagForm: { resetFields: vi.fn(), setFieldsValue: vi.fn() },
      setRenameViewTarget: vi.fn(),
      setIsCreateTagModalOpen: vi.fn(),
      removeConnectionTag: vi.fn(),
      onCreateConnectionInGroup,
    };

    const items = buildSidebarLegacyNodeMenuItems(node, context) as Array<{ key?: string; onClick?: () => void }>;
    const createItem = items.find((item) => item?.key === 'new-connection-in-tag');

    expect(createItem).toBeDefined();
    createItem?.onClick?.();
    expect(onCreateConnectionInGroup).toHaveBeenCalledWith('production');
  });

  it('carries the right-clicked group through creation and assigns the saved connection', () => {
    const sidebarSource = readSource('./Sidebar.tsx');
    const sharedMenuSource = readSource('./sidebar/sidebarLegacyNodeMenu.tsx');
    const v2ActionHandlerSource = readSource('./sidebar/useSidebarV2ActionHandlers.tsx');
    const appSource = readSource('../App.tsx');

    expect(sidebarSource).toContain('onCreateConnectionInGroup,');
    expect(sidebarSource).toContain('const items = getNodeMenuItems(node);');
    expect(sidebarSource).toContain('resolveV2ConnectionGroup(node, v2RailConnectionGroups)');
    expect(sidebarSource).toContain("kind: 'v2-connection-group'");
    expect(sharedMenuSource).toContain("key: 'new-connection-in-tag'");
    expect(sharedMenuSource).toContain('onCreateConnectionInGroup?.(tagId)');
    expect(v2ActionHandlerSource).toContain("if (action === 'new-connection')");
    expect(v2ActionHandlerSource).toContain('onCreateConnectionInGroup?.(tag.id)');
    expect(appSource).toContain('pendingConnectionTagIdRef.current = normalizedTargetTagId || null;');
    expect(appSource).toContain('moveConnectionToTag(savedConnection.id, targetTagId);');
  });
});
