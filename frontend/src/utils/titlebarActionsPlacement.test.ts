import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS,
  sanitizeTitlebarActionsPlacementSettings,
} from './titlebarActionsPlacement';

describe('titlebarActionsPlacement', () => {
  it('defaults to the separate toolbar', () => {
    expect(DEFAULT_TITLEBAR_ACTIONS_PLACEMENT_SETTINGS).toEqual({ titlebarActionsPlacement: 'toolbar' });
    expect(sanitizeTitlebarActionsPlacementSettings(undefined)).toEqual({ titlebarActionsPlacement: 'toolbar' });
    expect(sanitizeTitlebarActionsPlacementSettings({})).toEqual({ titlebarActionsPlacement: 'toolbar' });
  });

  it('keeps the title bar placement and rejects unknown values', () => {
    expect(sanitizeTitlebarActionsPlacementSettings({ titlebarActionsPlacement: 'titlebar' })).toEqual({ titlebarActionsPlacement: 'titlebar' });
    expect(sanitizeTitlebarActionsPlacementSettings({ titlebarActionsPlacement: 'toolbar' })).toEqual({ titlebarActionsPlacement: 'toolbar' });
    expect(sanitizeTitlebarActionsPlacementSettings({ titlebarActionsPlacement: 'menu' as never })).toEqual({ titlebarActionsPlacement: 'toolbar' });
  });
});
