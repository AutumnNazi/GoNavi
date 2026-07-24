import { describe, expect, it } from 'vitest';

import {
  PROVIDER_PRESET_CARD_BASE_STYLE,
  PROVIDER_PRESET_CARD_CONTENT_STYLE,
  PROVIDER_PRESET_CARD_DESCRIPTION_STYLE,
  PROVIDER_PRESET_GRID_STYLE,
  PROVIDER_PRESET_CARD_TITLE_STYLE,
} from './aiSettingsPresetLayout';

describe('ai settings preset layout', () => {
  it('uses compact two-column rows instead of provider cards', () => {
    expect(PROVIDER_PRESET_GRID_STYLE).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      columnGap: 12,
      rowGap: 0,
      gridAutoRows: '58px',
      alignItems: 'stretch',
    });
  });

  it('stretches each provider choice to fill the row without rounded-card decoration', () => {
    expect(PROVIDER_PRESET_CARD_BASE_STYLE).toMatchObject({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      height: '100%',
      minHeight: '58px',
      overflow: 'hidden',
      borderRadius: 0,
      textAlign: 'left',
    });
  });

  it('keeps the text column compact instead of pinning the description to the bottom', () => {
    expect(PROVIDER_PRESET_CARD_CONTENT_STYLE).toMatchObject({
      minWidth: 0,
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
    });

    expect(PROVIDER_PRESET_CARD_DESCRIPTION_STYLE).toMatchObject({
      marginTop: 2,
      display: '-webkit-box',
      WebkitLineClamp: 1,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    });

    expect(PROVIDER_PRESET_CARD_TITLE_STYLE).toMatchObject({
      display: '-webkit-box',
      WebkitLineClamp: 1,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    });
  });
});
