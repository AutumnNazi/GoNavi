import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { ConnectionConfigPanels } from './ConnectionConfigPanels';

it('mounts only visited sections, skips hidden reconciliation, and refreshes on activation', () => {
  const renders = vi.fn();
  function Panel({ name, value }: { name: string; value: number }) {
    renders(name, value);
    return <input data-panel={name} value={value} readOnly />;
  }
  const sections = (value: number) => ({
    basic: <Panel name="basic" value={value} />, network: <Panel name="network" value={value} />,
    appearance: <Panel name="appearance" value={value} />, advanced: <Panel name="advanced" value={value} />,
  });
  let view!: ReactTestRenderer;
  act(() => { view = create(<ConnectionConfigPanels active="basic" sections={sections(1)} />); });
  expect(view.root.findAllByType('input')).toHaveLength(1);
  act(() => view.update(<ConnectionConfigPanels active="network" sections={sections(2)} />));
  expect(view.root.findAllByType('input')).toHaveLength(2);
  renders.mockClear();
  act(() => view.update(<ConnectionConfigPanels active="network" sections={sections(3)} />));
  expect(renders.mock.calls).toEqual([['network', 3]]);
  act(() => view.update(<ConnectionConfigPanels active="basic" sections={sections(4)} />));
  expect(view.root.findByProps({ 'data-panel': 'basic' }).props.value).toBe(4);
  expect(view.root.findAllByType('input')).toHaveLength(2);
  act(() => view.unmount());
});
