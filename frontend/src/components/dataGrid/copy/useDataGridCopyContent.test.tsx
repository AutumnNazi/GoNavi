// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dropdown } from 'antd';
import { GONAVI_ROW_KEY, makeCellKey } from '../core/dataGridCellKeys';
import { V2CellContextMenuView } from '../../V2TableContextMenu';
import { DataGridCopyContentMenu } from './DataGridCopyContentMenu';
import { useDataGridCopyContent, type DataGridCopyContentApi, type UseDataGridCopyContentInput } from './useDataGridCopyContent';
import type { DataGridCopyContent, DataGridCopyScope } from './dataGridCopyContent';

const formatSpy = vi.hoisted(() => vi.fn((value: unknown) => String(value)));
vi.mock('../core/dataGridCellDisplay', () => ({ formatClipboardCellText: formatSpy }));

const scopes: DataGridCopyScope[] = ['selected', 'allLoaded'];
const modes: DataGridCopyContent[] = ['headers', 'data', 'headersAndData'];

describe('copy content hook and real context menu', () => {
  let renderer: ReactTestRenderer;
  let api: DataGridCopyContentApi;
  const clipboard = vi.fn();
  const onCopied = vi.fn();
  const legacyAction = vi.fn();
  const defaults: UseDataGridCopyContentInput = {
    rows: [{ [GONAVI_ROW_KEY]: 'b', name: 'Bob', id: 2 }, { [GONAVI_ROW_KEY]: 'a', name: 'Alice', id: 1 }],
    columnNames: ['name', 'id', GONAVI_ROW_KEY], selectedRowKeys: ['a'], selectedCells: new Set(),
    copyToClipboard: clipboard, translate: (key) => key,
  };
  function Harness({ input }: { input: UseDataGridCopyContentInput }) {
    api = useDataGridCopyContent(input);
    return <>
      <Dropdown menu={{ items: api.menuItems }}><button>Copy</button></Dropdown>
      <V2CellContextMenuView fieldName="name" supportsCopyInsert onAction={legacyAction}
        regularCopyMenu={<DataGridCopyContentMenu groups={api.groups} onCopied={onCopied} />} />
    </>;
  }
  const mount = (input = defaults) => { act(() => { renderer = create(<Harness input={input} />); }); };
  const click = (scope: DataGridCopyScope, mode: DataGridCopyContent) => {
    const section = renderer.root.findByProps({ 'data-grid-copy-scope': scope });
    const button = section.findAllByType('button')[modes.indexOf(mode)];
    act(() => button.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
  };
  afterEach(() => { act(() => renderer?.unmount()); vi.clearAllMocks(); });

  for (const scope of scopes) for (const mode of modes) {
    it(`executes ${scope}/${mode} through the real context menu`, () => {
      mount();
      click(scope, mode);
      const data = scope === 'selected' ? 'Alice\t1' : 'Bob\t2\nAlice\t1';
      expect(clipboard.mock.calls[0][0].plainText).toBe(mode === 'headers' ? 'name\tid' : mode === 'data' ? data : `name\tid\n${data}`);
      expect(onCopied).toHaveBeenCalledOnce();
      expect(legacyAction).not.toHaveBeenCalled();
    });
  }

  it('shares exact callbacks and disabled states with toolbar dropdown items', () => {
    mount();
    const toolbar = renderer.root.findByType(Dropdown);
    const items = toolbar.props.menu.items;
    expect(items).toHaveLength(2);
    for (const [groupIndex, scope] of scopes.entries()) for (const [itemIndex, mode] of modes.entries()) {
      const item = items[groupIndex].children[itemIndex];
      expect(item.disabled).toBe(api.groups[groupIndex].items[itemIndex].disabled);
      act(() => item.onClick());
      click(scope, mode);
      const last = clipboard.mock.calls.length - 1;
      expect(clipboard.mock.calls[last][0]).toEqual(clipboard.mock.calls[last - 1][0]);
    }
  });

  it('does not format values on render, rerender or headers-only clicks', () => {
    mount();
    act(() => renderer.update(<Harness input={{ ...defaults }} />));
    expect(formatSpy).not.toHaveBeenCalled();
    click('selected', 'headers');
    click('allLoaded', 'headers');
    expect(formatSpy).not.toHaveBeenCalled();
    click('allLoaded', 'data');
    expect(formatSpy).toHaveBeenCalledTimes(4);
  });

  it('reads latest box-selection ref at click time, then updates menus on state change', () => {
    const currentSelectionRef = { current: new Set<string>() };
    mount({ ...defaults, currentSelectionRef });
    currentSelectionRef.current = new Set([makeCellKey('b', 'id')]);
    click('selected', 'headersAndData');
    expect(clipboard.mock.lastCall?.[0].plainText).toBe('id\n2');
    act(() => renderer.update(<Harness input={{ ...defaults, selectedCells: currentSelectionRef.current }} />));
    click('selected', 'data');
    expect(clipboard.mock.lastCall?.[0].plainText).toBe('2');
  });

  it('disables and guards every selected action with no selection instead of copying all', () => {
    mount({ ...defaults, selectedRowKeys: [] });
    expect(api.groups[0].items.every((item) => item.disabled)).toBe(true);
    for (const mode of modes) { click('selected', mode); act(() => api.copy('selected', mode)); }
    expect(clipboard).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
    click('allLoaded', 'data');
    expect(clipboard).toHaveBeenCalledOnce();
  });

  it('keeps all-loaded headers enabled with columns but no rows', () => {
    mount({ ...defaults, rows: [], selectedRowKeys: [] });
    expect(api.canCopy).toBe(true);
    expect(api.groups[1].items.map((item) => item.disabled)).toEqual([false, true, true]);
    click('allLoaded', 'headers');
    expect(clipboard.mock.lastCall?.[0].plainText).toBe('name\tid');
  });

  it('preserves dedicated JSON/CSV/SQL action routing', () => {
    mount();
    const buttons = renderer.root.findAllByType('button');
    for (const action of ['copy-json', 'copy-csv', 'copy-insert', 'copy-update', 'copy-delete']) {
      const item = renderer.root.findAll((node) => node.props.item?.action === action)[0];
      const button = item.findByType('button');
      expect(buttons).toContain(button);
      act(() => button.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
      expect(legacyAction).toHaveBeenLastCalledWith(action);
    }
    expect(clipboard).not.toHaveBeenCalled();
  });
});
