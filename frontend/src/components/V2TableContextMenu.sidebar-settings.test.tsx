// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { V2ConnectionContextMenuView } from './V2TableContextMenu';
import { V2TableContextMenuItem } from './v2ContextMenu/v2ContextMenuPrimitives';

describe('connection menu sidebar settings entry', () => {
  it('keeps connection actions directly visible and uses a normal menu item for settings', () => {
    const onAction = vi.fn();
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<V2ConnectionContextMenuView connectionName="test" onAction={onAction} />); });
    const items = renderer.root.findAllByType(V2TableContextMenuItem);
    const actions = items.map(item => item.props.item.action);
    expect(actions).toEqual(expect.arrayContaining(['refresh', 'edit', 'copy-connection', 'disconnect', 'delete', 'sidebar-settings']));
    const settings = items.find(item => item.props.item.action === 'sidebar-settings')!;
    const button = settings.findByType('button');
    expect(button.props.role).toBe('menuitem');
    expect(button.props.className).toContain('gn-v2-context-menu-item');
    act(() => button.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
    expect(onAction).toHaveBeenCalledWith('sidebar-settings');
    expect(renderer.root.findAll(node => node.props.role === 'switch')).toHaveLength(0);
    act(() => renderer.unmount());
  });
});
