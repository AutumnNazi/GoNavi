import type { CSSProperties } from 'react';

export const PROVIDER_PRESET_CARD_HEIGHT = 58;

export const PROVIDER_PRESET_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  columnGap: 12,
  rowGap: 2,
  gridAutoRows: `${PROVIDER_PRESET_CARD_HEIGHT}px`,
  alignItems: 'stretch',
};

export const PROVIDER_PRESET_CARD_BASE_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 0.16s ease, border-color 0.16s ease',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: '100%',
  minHeight: `${PROVIDER_PRESET_CARD_HEIGHT}px`,
  boxSizing: 'border-box',
  overflow: 'hidden',
  textAlign: 'left',
};

export const PROVIDER_PRESET_CARD_CONTENT_STYLE: CSSProperties = {
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

export const PROVIDER_PRESET_CARD_DESCRIPTION_STYLE: CSSProperties = {
  marginTop: 2,
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export const PROVIDER_PRESET_CARD_TITLE_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
