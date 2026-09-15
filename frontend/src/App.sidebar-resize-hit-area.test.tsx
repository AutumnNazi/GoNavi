import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import {
  resolveSidebarResizeHitGeometry,
} from './utils/sidebarLayout';

describe('sidebar resize hit area', () => {
  it('keeps the native tree scrollbar outside the width resize hit area', () => {
    const hit = resolveSidebarResizeHitGeometry(16);
    const renderer = create(
      <div
        data-sidebar-panel="true"
        style={{ [hit.cssVariable]: `${hit.innerHitWidth}px` } as React.CSSProperties}
      >
        <div
          data-sidebar-resize-handle="true"
          style={{
            position: 'absolute',
            right: hit.handleOffset,
            width: hit.handleWidth,
          }}
        />
      </div>,
    );

    const sider = renderer.root.findByProps({ 'data-sidebar-panel': 'true' });
    const handle = renderer.root.findByProps({ 'data-sidebar-resize-handle': 'true' });
    expect(sider.props.style[hit.cssVariable]).toBe('8px');
    expect(handle.props.style.right).toBe(-8);
    expect(handle.props.style.width).toBe(16);
    expect(hit.handleOffset).toBeLessThan(0);
    expect(Math.abs(hit.handleOffset)).toBe(hit.innerHitWidth);
    renderer.unmount();
  });
});
