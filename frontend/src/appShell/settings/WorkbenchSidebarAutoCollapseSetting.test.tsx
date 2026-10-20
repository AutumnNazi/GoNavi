import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '../../store/storeConstants';
import { WorkbenchSidebarAutoCollapseSetting } from './WorkbenchSidebarAutoCollapseSetting';

vi.mock('antd', () => ({ Switch: (props: { checked: boolean; onChange: (value: boolean) => void }) =>
  <button aria-pressed={props.checked} onClick={() => props.onChange(!props.checked)} /> }));

it('exposes the default-off preference and writes changes through the appearance setter', () => {
  const setAppearance = vi.fn();
  const props = { appearance: DEFAULT_APPEARANCE, setAppearance, t: (key: string) => key,
    renderThemeSettingsRow: ({ control }: { control: React.ReactNode }) => <div>{control}</div> };
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<WorkbenchSidebarAutoCollapseSetting {...props} />); });
  expect(renderer.root.findByType('button').props['aria-pressed']).toBe(false);
  act(() => renderer.root.findByType('button').props.onClick());
  expect(setAppearance).toHaveBeenLastCalledWith({ workbenchSidebarAutoCollapse: true });
  act(() => renderer.update(<WorkbenchSidebarAutoCollapseSetting {...props} appearance={{ ...DEFAULT_APPEARANCE, workbenchSidebarAutoCollapse: true }} />));
  act(() => renderer.root.findByType('button').props.onClick());
  expect(setAppearance).toHaveBeenLastCalledWith({ workbenchSidebarAutoCollapse: false });
  act(() => renderer.unmount());
});
