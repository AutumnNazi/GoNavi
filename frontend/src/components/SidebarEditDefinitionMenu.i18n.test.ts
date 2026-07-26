import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');

describe('Sidebar edit definition menu i18n', () => {
  it('localizes edit definition menu labels', () => {
    expect(source).not.toContain("label: '编辑定义'");
    expect(source.match(/label: t\('sidebar\.menu\.edit_definition'\)/g) || []).toHaveLength(2);
  });
});
