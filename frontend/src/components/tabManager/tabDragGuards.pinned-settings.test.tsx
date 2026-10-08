import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DndContext } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { describe, expect, it } from 'vitest';

import { SETTINGS_CENTER_WORKBENCH_TAB_ID } from '../../utils/settingsCenterTab';
import { DraggableTabNode } from './tabDragGuards';

const renderTabs = (ids: string[]): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <DndContext>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {ids.map((id) => (
            <DraggableTabNode key={id} node={<div key={id} data-tab-id={id} className="ant-tabs-tab" />} />
          ))}
        </SortableContext>
      </DndContext>,
    );
  });
  return renderer;
};

const findTab = (renderer: ReactTestRenderer, id: string) => (
  renderer.root.find((node) => node.type === 'div' && node.props['data-tab-id'] === id)
);

describe('DraggableTabNode with the settings center', () => {
  it('leaves the settings-center tab without drag handlers while other tabs stay draggable', () => {
    const renderer = renderTabs([SETTINGS_CENTER_WORKBENCH_TAB_ID, 'users']);

    const settingsTab = findTab(renderer, SETTINGS_CENTER_WORKBENCH_TAB_ID);
    expect(settingsTab.props.onPointerDown).toBeUndefined();
    expect(settingsTab.props.className).toBe('ant-tabs-tab');
    expect(settingsTab.props.style?.cursor).toBeUndefined();

    const usersTab = findTab(renderer, 'users');
    expect(typeof usersTab.props.onPointerDown).toBe('function');
    expect(usersTab.props.className).toContain('tab-dnd-node');
    expect(usersTab.props.style?.cursor).toBe('grab');
  });
});
