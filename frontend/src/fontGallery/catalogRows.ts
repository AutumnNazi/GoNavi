import { fontFamilyKey, systemHasFamily } from './options';
import { RECOMMENDED_FONTS } from './recommendedCatalog';
import type { FontEntry, FontInstalled } from './types';
import type { InstalledFontFamily } from '../utils/fontFamilies';

export interface CatalogRow {
  id: string;
  kind: 'ui' | 'mono';
  family: string;
  names: Record<string, string>;
  description: string;
  useCase: string;
  licenseName: string;
  remote?: FontEntry;
}

export function buildFontCatalogRows(
  entries: FontEntry[],
  systemFamilies: InstalledFontFamily[],
  installed: FontInstalled[],
): CatalogRow[] {
  const rows: CatalogRow[] = [];
  const seenIds = new Set<string>();
  const seenFamilies = new Set<string>();
  const append = (row: CatalogRow) => {
    const key = fontFamilyKey(row.family);
    if (seenIds.has(row.id) || seenFamilies.has(key)) return;
    seenIds.add(row.id);
    seenFamilies.add(key);
    // 本机已有字体不再重复推荐；保留下载记录以便管理/删除。
    const downloaded = installed.some(item => fontFamilyKey(item.entry.family) === key);
    if (!downloaded && systemHasFamily(systemFamilies, row.family)) return;
    rows.push(row);
  };
  const fromEntry = (entry: FontEntry): CatalogRow => ({
    ...entry, licenseName: entry.license.name, remote: entry,
  });
  for (const recommended of RECOMMENDED_FONTS) {
    const remote = entries.find(entry => entry.id === recommended.id
      || fontFamilyKey(entry.family) === fontFamilyKey(recommended.family));
    append(remote ? fromEntry(remote) : recommended);
  }
  for (const entry of entries) append(fromEntry(entry));
  return rows;
}
