import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_UTILITY_ITEM_KEYS,
  resolveLegacyAIEdgeHandleAttachment,
  resolveLegacyAIEdgeHandleDockStyle,
  resolveLegacyAIEdgeHandleStyle,
} from './aiEntryLayout';

describe('ai entry layout', () => {
  it('keeps the legacy sidebar utility area limited to the unified settings entry', () => {
    expect(SIDEBAR_UTILITY_ITEM_KEYS).toEqual(['settings']);
  });

  it('attaches the legacy closed AI handle to the content shell', () => {
    expect(resolveLegacyAIEdgeHandleAttachment(false)).toBe('content-shell');
  });

  it('attaches the legacy open AI handle to the panel shell', () => {
    expect(resolveLegacyAIEdgeHandleAttachment(true)).toBe('panel-shell');
  });

  it('keeps the legacy closed handle docked on the content edge', () => {
    expect(resolveLegacyAIEdgeHandleDockStyle('content-shell')).toMatchObject({
      position: 'absolute',
      top: 16,
      right: 0,
      zIndex: 12,
    });
  });

  it('keeps the legacy open handle outside the panel shell to avoid header overlap', () => {
    expect(resolveLegacyAIEdgeHandleDockStyle('panel-shell')).toMatchObject({
      position: 'absolute',
      top: 16,
      right: '100%',
      zIndex: 12,
    });
  });

  it('uses the attached active appearance when the legacy AI panel is open', () => {
    const style = resolveLegacyAIEdgeHandleStyle({
      darkMode: true,
      aiPanelVisible: true,
      effectiveUiScale: 1,
    });

    expect(style.color).toBe('#ffd666');
    expect(style.background).toBe('rgba(255,214,102,0.12)');
    expect(style.borderRadius).toBe('10px 0 0 10px');
    expect(style.borderRight).toBe('none');
    expect(style.height).toBe(24);
  });
});
