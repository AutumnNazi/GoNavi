// @vitest-environment jsdom
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n';
import { V2TableContextMenuView } from './V2TableContextMenuView';

const findMockDataItem = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll(
  (node) => node.type === 'span'
    && node.props.className === 'gn-v2-context-menu-item-title'
    && node.props.children === t('sidebar.v2_table_menu.generate_mock_data'),
).map((title) => title.parent!);

describe('V2TableContextMenuView mock data item', () => {
  it('shows the item only when the data source supports mock data and reports the action', () => {
    const onAction = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<V2TableContextMenuView tableName="users" supportsMockData onAction={onAction} />);
    });
    const items = findMockDataItem(renderer);
    expect(items).toHaveLength(1);
    act(() => items[0].props.onClick({ preventDefault: () => undefined, stopPropagation: () => undefined }));
    expect(onAction).toHaveBeenCalledWith('mock-data');

    act(() => {
      renderer.update(<V2TableContextMenuView tableName="users" onAction={onAction} />);
    });
    expect(findMockDataItem(renderer)).toHaveLength(0);
  });
});
