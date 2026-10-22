import { describe, expect, it, vi } from 'vitest';
import { buildToolCenterGroups } from './toolCenterGroups';
import type { BuildToolCenterGroupsInput } from './toolCenterGroups';
import { isToolCenterGroupKey } from '../settingsCenterPanes';

describe('appShell plugin settings entry', () => {
  it('routes the navigation entry to the plugin tool pane without root App wiring', () => {
    const navigate = vi.fn();
    const input: BuildToolCenterGroupsInput = { t: (key: string) => key, handleOpenToolCenterPane: navigate,
      securityUpdateEntryVisibility: { showDetailEntry: false, showIntro: false, showBanner: false }, securityUpdateHasLegacySensitiveItems: false,
      securityUpdateStatusMeta: { label: '', description: '', tone: 'default' } };
    const groups = buildToolCenterGroups(input).toolCenterGroups;
    const entry = groups.flatMap((group) => group.items).find((item) => item.key === 'plugins');
    expect(entry?.title).toBe('plugin.manager.title');
    entry?.onClick();
    expect(navigate).toHaveBeenCalledWith('config', 'plugins');
    expect(isToolCenterGroupKey('config')).toBe(true);
  });
});
