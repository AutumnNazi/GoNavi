import { describe, expect, it, vi } from 'vitest';
import { buildToolCenterGroups } from './toolCenterGroups';
import type { BuildToolCenterGroupsInput } from './toolCenterGroups';
import { isToolCenterGroupKey, resolveSettingsCenterGroupInitialPane } from '../settingsCenterPanes';

const baseInput: BuildToolCenterGroupsInput = {
  t: (key: string) => key,
  handleOpenToolCenterPane: vi.fn(),
  securityUpdateEntryVisibility: { showDetailEntry: false, showIntro: false, showBanner: false },
  securityUpdateHasLegacySensitiveItems: false,
  securityUpdateStatusMeta: { label: '', description: '', tone: 'default' },
};

describe('appShell plugin settings entry', () => {
  it('exposes 插件 as a leaf tool group before 数据与安全, without a nested same-name item', () => {
    const groups = buildToolCenterGroups(baseInput).toolCenterGroups;
    expect(groups.map((group) => group.key)).toEqual(['plugins', 'config']);
    expect(groups[0].title).toBe('plugin.manager.title');
    expect(groups[0].items).toEqual([]);
    expect(groups[1].items.map((item) => item.key)).toEqual(['data-root', 'security-update']);
  });

  it('resolves the plugin tool pane from the group itself without root App wiring', () => {
    expect(isToolCenterGroupKey('plugins')).toBe(true);
    expect(resolveSettingsCenterGroupInitialPane('plugins')).toEqual({ key: 'plugins', group: 'plugins' });
  });
});
