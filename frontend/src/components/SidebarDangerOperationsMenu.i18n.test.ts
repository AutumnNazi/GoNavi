import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./sidebar/sidebarLegacyNodeMenu.tsx', import.meta.url), 'utf8');

describe('Sidebar danger operations menu i18n', () => {
  it('localizes danger operation group labels', () => {
    expect(source).not.toContain("label: '危险操作'");
    expect(source.match(/label: t\('sidebar\.menu\.danger_operations'\)/g) || []).toHaveLength(4);
  });
});
