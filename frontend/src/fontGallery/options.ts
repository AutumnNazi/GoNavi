import { MONO_FONT_FALLBACK_STACK, UI_FONT_FALLBACK_STACK, type FontFamilyOption } from '../utils/fontFamilies';
import type { FontInstalled } from './types';
import { getPrimaryFontFamily } from '../utils/fontFamilyDisplay';

export const fontFamilyKey = (family: string): string => family.trim().replace(/\s+/g, ' ').toLowerCase();

export function cssStack(family: string, kind: 'ui' | 'mono'): string {
  const fallback = kind === 'ui' ? UI_FONT_FALLBACK_STACK : MONO_FONT_FALLBACK_STACK;
  return '"' + family.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '", ' + fallback;
}

export function mergeDownloadedFontOptions(
  base: FontFamilyOption[],
  installed: FontInstalled[],
  kind: 'ui' | 'mono',
  activeValue?: string | null,
): FontFamilyOption[] {
  const result: FontFamilyOption[] = [];
  const positions = new Map<string, number>();
  for (const option of base) {
    const key = option.isDefault ? 'default' : fontFamilyKey(getPrimaryFontFamily(option.value));
    if (positions.has(key)) continue;
    positions.set(key, result.length);
    result.push(option);
  }
  const activeFamily = activeValue ? fontFamilyKey(getPrimaryFontFamily(activeValue)) : '';
  for (const item of installed) {
    if (item.entry.kind !== kind) continue;
    const key = fontFamilyKey(item.entry.family);
    const position = positions.get(key);
    const active = activeFamily === fontFamilyKey(item.family);
    // 同名字体优先保留本机版本，但不改写用户当前使用的下载字体配置。
    if (position !== undefined && !active) continue;
    const option = {
      value: active && activeValue ? activeValue : cssStack(item.family, kind),
      label: item.entry.names['zh-CN'] || item.entry.names['en-US'] || item.entry.family,
      keywords: ['downloaded', 'installed', item.entry.family.toLowerCase(), item.entry.id],
    };
    if (position !== undefined) result[position] = option;
    else {
      positions.set(key, result.length);
      result.push(option);
    }
  }
  return result;
}

export function systemHasFamily(families: Array<{ family: string } | string>, name: string): boolean {
  const needle = fontFamilyKey(name);
  return families.some(entry => {
    const family = typeof entry === 'string' ? entry : entry.family;
    return fontFamilyKey(family) === needle;
  });
}
