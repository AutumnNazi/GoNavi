import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { useQueryEditorEverActive } from './useQueryEditorEverActive';

let latest = false;
const Probe = ({ active }: { active: boolean }) => {
  latest = useQueryEditorEverActive(active);
  return null;
};

describe('useQueryEditorEverActive', () => {
  it('stays false until first activation, then never drops back', () => {
    const renderer = create(<Probe active={false} />);
    expect(latest).toBe(false);
    act(() => { renderer.update(<Probe active />); });
    expect(latest).toBe(true);
    act(() => { renderer.update(<Probe active={false} />); });
    expect(latest).toBe(true);
  });

  it('starts latched when the editor mounts as the active tab', () => {
    create(<Probe active />);
    expect(latest).toBe(true);
  });
});
