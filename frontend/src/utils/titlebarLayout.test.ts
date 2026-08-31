import { describe, expect, it } from 'vitest';

import { resolveTitleBarLayout } from './titlebarLayout';

describe('titlebarLayout', () => {
  it('restores the compact V2 titlebar while the explorer is expanded', () => {
    expect(resolveTitleBarLayout(1, true)).toEqual({
      height: 32,
      actionHeight: 26,
      dividerHeight: 12,
      emptyWorkbenchTopOffset: 0,
    });
  });

  it('keeps the expanded V2 layout responsive to the configured UI scale', () => {
    expect(resolveTitleBarLayout(0.8, true, false)).toEqual({
      height: 28,
      actionHeight: 24,
      dividerHeight: 10,
      emptyWorkbenchTopOffset: 0,
    });
    expect(resolveTitleBarLayout(1.25, true, false)).toEqual({
      height: 40,
      actionHeight: 33,
      dividerHeight: 15,
      emptyWorkbenchTopOffset: 0,
    });
    expect(resolveTitleBarLayout(1.1, true, false)).toEqual({
      height: 35,
      actionHeight: 29,
      dividerHeight: 13,
      emptyWorkbenchTopOffset: 0,
    });
  });

  it('keeps the taller V2 titlebar only while collapsed actions are docked into it', () => {
    expect(resolveTitleBarLayout(1, true, true)).toEqual({
      height: 57,
      actionHeight: 26,
      dividerHeight: 12,
      emptyWorkbenchTopOffset: 25,
    });
    expect(resolveTitleBarLayout(0.8, true, true)).toEqual({
      height: 52,
      actionHeight: 24,
      dividerHeight: 10,
      emptyWorkbenchTopOffset: 24,
    });
    expect(resolveTitleBarLayout(1.25, true, true)).toEqual({
      height: 70,
      actionHeight: 33,
      dividerHeight: 15,
      emptyWorkbenchTopOffset: 30,
    });
    expect(resolveTitleBarLayout(1.1, true, true)).toEqual({
      height: 62,
      actionHeight: 29,
      dividerHeight: 13,
      emptyWorkbenchTopOffset: 27,
    });
  });

  it.each([0.8, 0.9, 0.95, 1, 1.1, 1.25])(
    'keeps the empty workbench content origin stable at UI scale %s',
    (scale) => {
      const expanded = resolveTitleBarLayout(scale, true, false);
      const collapsed = resolveTitleBarLayout(scale, true, true);

      expect(collapsed.height - collapsed.emptyWorkbenchTopOffset).toBe(expanded.height);
    },
  );

  it.each([0.8, 0.9, 0.95, 1, 1.1, 1.25])(
    'keeps the two macOS titlebar rows separated at UI scale %s',
    (scale) => {
      const layout = resolveTitleBarLayout(scale, true, true);
      const upperBandBottom = 16 + (Math.max(26, layout.actionHeight) / 2);
      const collapsedBandTop = layout.height - 1 - (26 * scale);

      expect(collapsedBandTop - upperBandBottom).toBeGreaterThanOrEqual(1);
    },
  );

  it('preserves the compact legacy titlebar dimensions', () => {
    expect(resolveTitleBarLayout(1, false)).toEqual({
      height: 32,
      actionHeight: 26,
      dividerHeight: 12,
      emptyWorkbenchTopOffset: 0,
    });
  });
});
