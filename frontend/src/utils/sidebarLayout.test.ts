import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_INNER_HIT_CSS_VARIABLE,
  SIDEBAR_RESIZE_MAX_WIDTH,
  SIDEBAR_RESIZE_MIN_WIDTH,
  resolveSidebarResizeHitGeometry,
  resolveSidebarResizeMaxWidth,
  sanitizeSidebarWidth,
} from './sidebarLayout';

describe('sidebar layout bounds', () => {
  it('allows wider persisted sidebar widths while keeping invalid values safe', () => {
    expect(sanitizeSidebarWidth(880)).toBe(880);
    expect(sanitizeSidebarWidth(1200)).toBe(SIDEBAR_RESIZE_MAX_WIDTH);
    expect(sanitizeSidebarWidth(120)).toBe(SIDEBAR_RESIZE_MIN_WIDTH);
    expect(sanitizeSidebarWidth('bad')).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('keeps enough workbench space when resolving drag width on smaller windows', () => {
    expect(resolveSidebarResizeMaxWidth(1600)).toBe(SIDEBAR_RESIZE_MAX_WIDTH);
    expect(resolveSidebarResizeMaxWidth(1180)).toBe(820);
    expect(resolveSidebarResizeMaxWidth(480)).toBe(SIDEBAR_RESIZE_MIN_WIDTH);
  });

  it('places half the resize handle over the workbench so the tree scrollbar stays outside the inner hit', () => {
    expect(resolveSidebarResizeHitGeometry(16)).toEqual({
      cssVariable: SIDEBAR_RESIZE_INNER_HIT_CSS_VARIABLE,
      innerHitWidth: 8,
      handleOffset: -8,
      handleWidth: 16,
    });
    expect(resolveSidebarResizeHitGeometry(24)).toMatchObject({
      innerHitWidth: 12,
      handleOffset: -12,
      handleWidth: 24,
    });
  });
});
