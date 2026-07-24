import type { CSSProperties } from 'react';

export const SIDEBAR_UTILITY_ITEM_KEYS = ['settings'] as const;

export type AIEntryPlacement = 'content-edge';
export type LegacyAIEdgeHandleAttachment = 'content-shell' | 'panel-shell';
export type AIEdgeHandleAttachment = LegacyAIEdgeHandleAttachment;

export interface ResolveLegacyAIEdgeHandleStyleInput {
  darkMode: boolean;
  aiPanelVisible: boolean;
  effectiveUiScale: number;
}

export type ResolveAIEdgeHandleStyleInput = ResolveLegacyAIEdgeHandleStyleInput;

export const resolveAIEntryPlacement = (): AIEntryPlacement => 'content-edge';

export const resolveLegacyAIEdgeHandleAttachment = (
  aiPanelVisible: boolean,
): LegacyAIEdgeHandleAttachment => (aiPanelVisible ? 'panel-shell' : 'content-shell');

export const resolveAIEdgeHandleAttachment = resolveLegacyAIEdgeHandleAttachment;

export const resolveLegacyAIEdgeHandleDockStyle = (
  attachment: LegacyAIEdgeHandleAttachment,
): CSSProperties => ({
  position: 'absolute',
  top: 16,
  right: attachment === 'panel-shell' ? '100%' : 0,
  zIndex: 12,
});

export const resolveAIEdgeHandleDockStyle = resolveLegacyAIEdgeHandleDockStyle;

export const resolveLegacyAIEdgeHandleStyle = ({
  darkMode,
  aiPanelVisible,
  effectiveUiScale,
}: ResolveLegacyAIEdgeHandleStyleInput): CSSProperties => {
  const inactiveColor = darkMode ? 'rgba(255,255,255,0.86)' : 'rgba(22,32,51,0.82)';
  const inactiveBackground = darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)';
  const inactiveBorder = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';

  return {
    height: Math.max(24, Math.round(24 * effectiveUiScale)),
    paddingInline: Math.max(8, Math.round(8 * effectiveUiScale)),
    borderRadius: '10px 0 0 10px',
    border: `1px solid ${aiPanelVisible ? (darkMode ? 'rgba(255,214,102,0.22)' : 'rgba(24,144,255,0.18)') : inactiveBorder}`,
    borderRight: 'none',
    background: aiPanelVisible ? (darkMode ? 'rgba(255,214,102,0.12)' : 'rgba(24,144,255,0.10)') : inactiveBackground,
    color: aiPanelVisible ? (darkMode ? '#ffd666' : '#1677ff') : inactiveColor,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Math.max(4, Math.round(4 * effectiveUiScale)),
    fontSize: Math.max(12, Math.round(12 * effectiveUiScale)),
    fontWeight: 600,
    lineHeight: 1,
    boxShadow: 'none',
    backdropFilter: 'none',
    WebkitBackdropFilter: 'none',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };
};

export const resolveAIEdgeHandleStyle = resolveLegacyAIEdgeHandleStyle;
