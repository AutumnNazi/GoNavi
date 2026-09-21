import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderSidebarV2TreeTitle } from './SidebarTreeTitle';

vi.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@ant-design/icons', () => ({
  StarFilled: () => <span data-star-icon="true" />,
}));

const renderTableTitle = () => create(<>{renderSidebarV2TreeTitle({
  node: {
    key: 'conn-main-table-users',
    title: 'users',
    type: 'table',
    dataRef: { id: 'conn', dbName: 'main', tableName: 'users' },
  },
  hoverTitle: 'users',
  connectionStatus: 'success',
  getV2TreeMetaText: () => '',
  sidebarTableMetadataFields: [],
  sidebarDropPlacement: null,
})}</>);

describe('SidebarTreeTitle drag ordering', () => {
  it('leaves dragging to the tree without rendering an extra ordering marker', () => {
    const renderer = renderTableTitle();
    const title = renderer.root.find((node) => String(node.props.className || '').includes('gn-v2-tree-title'));

    expect(renderer.root.findAllByProps({ 'data-sidebar-tree-order-handle': 'true' })).toHaveLength(0);
    expect(title.props.draggable).not.toBe(true);
    expect(title.props.onDragStart).toBeUndefined();
  });
});
