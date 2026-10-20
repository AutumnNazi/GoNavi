export const DEFAULT_UI_FONT_FAMILY =
  '"Inter", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", "Ubuntu", sans-serif';
export const DEFAULT_MONO_FONT_FAMILY =
  '"JetBrains Mono", "Noto Sans Mono CJK SC", "Noto Sans Mono", ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

const MAX_FONT_FAMILY_LENGTH = 512;
const LINUX_CJK_FONT_INSTALL_COMMAND = 'sudo apt install fonts-noto-cjk fonts-wqy-microhei && fc-cache -fv';

const CJK_FONT_KEYWORDS = [
  'noto sans cjk',
  'noto sans sc',
  'noto serif cjk',
  'noto serif sc',
  'source han sans',
  'source han serif',
  '思源',
  'wenquanyi',
  '文泉驿',
  'sarasa',
  '更纱',
  'lxgw',
  '霞鹜',
  'microsoft yahei',
  '微软雅黑',
  'simsun',
  '宋体',
  'simhei',
  '黑体',
  'pingfang',
  '苹方',
  'hiragino',
  '冬青',
];

export type FontFamilyOption = {
  value: string;
  label: string;
  labelKey?: string;
  isDefault?: boolean;
  keywords?: string[];
};

type FontFamilyLabelTranslator = (key: string) => string;

export type InstalledFontFamily = {
  family: string;
  path?: string;
};

export const UI_FONT_FALLBACK_STACK =
  '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "Microsoft YaHei", "Ubuntu", sans-serif';
export const MONO_FONT_FALLBACK_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", "Noto Sans Mono", "DejaVu Sans Mono", monospace';

const MONO_FONT_PRIORITY_HINTS = [
  'mono',
  'code',
  'console',
  'terminal',
  'jetbrains',
  'cascadia',
  'consolas',
  'courier',
  'fira',
  'hack',
  'iosevka',
  'menlo',
  'monaco',
  'operator',
  'sarasa',
  'sf mono',
  'source code',
  'ubuntu mono',
];

const normalizeFontSearchToken = (value: string): string => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');

const normalizeInstalledFontNameForCJK = (entry: string | InstalledFontFamily): string => {
  const raw = typeof entry === 'string' ? entry : entry.family;
  return String(raw || '').trim().toLowerCase();
};

const insertFontNameWordBreaks = (value: string): string => value
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replace(/([a-z\d])([A-Z])/g, '$1 $2');

const WINDOWS_UI_FONTS: FontFamilyOption[] = [
  { value: '"Segoe UI", "Microsoft YaHei", sans-serif', label: 'Segoe UI', keywords: ['windows', 'microsoft yahei', '雅黑'] },
  { value: '"Microsoft YaHei", "Segoe UI", sans-serif', label: 'Microsoft YaHei', keywords: ['windows', '雅黑'] },
  { value: '"Microsoft JhengHei", "Segoe UI", sans-serif', label: 'Microsoft JhengHei', keywords: ['windows', '繁中'] },
  { value: '"SimSun", serif', label: 'SimSun', keywords: ['windows', '宋体'] },
  { value: '"SimHei", sans-serif', label: 'SimHei', keywords: ['windows', '黑体'] },
  { value: '"Arial", "Segoe UI", sans-serif', label: 'Arial', keywords: ['windows'] },
  { value: '"Tahoma", "Segoe UI", sans-serif', label: 'Tahoma', keywords: ['windows'] },
];

const WINDOWS_MONO_FONTS: FontFamilyOption[] = [
  { value: '"JetBrains Mono", Consolas, monospace', label: 'JetBrains Mono', keywords: ['windows', 'code'] },
  { value: '"Cascadia Code", Consolas, monospace', label: 'Cascadia Code', keywords: ['windows', 'terminal'] },
  { value: '"Consolas", "Cascadia Mono", monospace', label: 'Consolas', keywords: ['windows'] },
  { value: '"Courier New", monospace', label: 'Courier New', keywords: ['windows'] },
];

const MAC_UI_FONTS: FontFamilyOption[] = [
  { value: '"Inter", "PingFang SC", -apple-system, sans-serif', label: 'Inter', keywords: ['mac', 'default'] },
  { value: '"PingFang SC", -apple-system, sans-serif', label: 'PingFang SC', keywords: ['mac', '苹方'] },
  { value: '"Helvetica Neue", -apple-system, sans-serif', label: 'Helvetica Neue', keywords: ['mac'] },
  { value: '"Hiragino Sans GB", -apple-system, sans-serif', label: 'Hiragino Sans GB', keywords: ['mac', '冬青黑体'] },
  { value: '"Songti SC", serif', label: 'Songti SC', keywords: ['mac', '宋体'] },
];

const MAC_MONO_FONTS: FontFamilyOption[] = [
  { value: '"JetBrains Mono", "SF Mono", Menlo, monospace', label: 'JetBrains Mono', keywords: ['mac', 'code'] },
  { value: '"SF Mono", Menlo, monospace', label: 'SF Mono', keywords: ['mac', 'system mono'] },
  { value: '"Menlo", "SF Mono", monospace', label: 'Menlo', keywords: ['mac'] },
  { value: '"Monaco", "SF Mono", monospace', label: 'Monaco', keywords: ['mac'] },
];

const LINUX_UI_FONTS: FontFamilyOption[] = [
  { value: '"Noto Sans", "Noto Sans CJK SC", "Noto Sans SC", sans-serif', label: 'Noto Sans', keywords: ['linux', 'default'] },
  { value: '"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", sans-serif', label: 'Noto Sans CJK SC', keywords: ['linux', 'cjk', '中文'] },
  { value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif', label: 'Source Han Sans SC', keywords: ['linux', 'cjk', '思源黑体'] },
  { value: '"Ubuntu", "Noto Sans CJK SC", "Noto Sans", sans-serif', label: 'Ubuntu', keywords: ['linux', 'ubuntu'] },
  { value: '"DejaVu Sans", "Noto Sans CJK SC", "Noto Sans", sans-serif', label: 'DejaVu Sans', keywords: ['linux'] },
  { value: '"Liberation Sans", "Noto Sans CJK SC", "Noto Sans", sans-serif', label: 'Liberation Sans', keywords: ['linux'] },
  { value: '"WenQuanYi Micro Hei", "Noto Sans CJK SC", sans-serif', label: 'WenQuanYi Micro Hei', keywords: ['linux', '文泉驿'] },
];

const LINUX_MONO_FONTS: FontFamilyOption[] = [
  { value: '"JetBrains Mono", "DejaVu Sans Mono", monospace', label: 'JetBrains Mono', keywords: ['linux', 'code'] },
  { value: '"Ubuntu Mono", "DejaVu Sans Mono", monospace', label: 'Ubuntu Mono', keywords: ['linux', 'ubuntu'] },
  { value: '"DejaVu Sans Mono", monospace', label: 'DejaVu Sans Mono', keywords: ['linux'] },
  { value: '"Liberation Mono", monospace', label: 'Liberation Mono', keywords: ['linux'] },
];

const SHARED_UI_FONTS: FontFamilyOption[] = [
  {
    value: DEFAULT_UI_FONT_FAMILY,
    label: 'Default UI font',
    labelKey: 'app.theme.font_family.default_ui_option',
    isDefault: true,
    keywords: ['default', 'system'],
  },
  { value: '"Inter", sans-serif', label: 'Inter', keywords: ['shared'] },
  { value: '"PingFang SC", sans-serif', label: 'PingFang SC', keywords: ['shared', '苹方'] },
  { value: '"Microsoft YaHei", sans-serif', label: 'Microsoft YaHei', keywords: ['shared', '雅黑'] },
  { value: '"Noto Sans CJK SC", sans-serif', label: 'Noto Sans CJK SC', keywords: ['shared', 'noto'] },
  { value: '"Source Han Sans SC", sans-serif', label: 'Source Han Sans SC', keywords: ['shared', 'source han', '思源黑体'] },
];

const SHARED_MONO_FONTS: FontFamilyOption[] = [
  {
    value: DEFAULT_MONO_FONT_FAMILY,
    label: 'Default code font',
    labelKey: 'app.theme.font_family.default_mono_option',
    isDefault: true,
    keywords: ['default', 'system', 'mono'],
  },
  { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono', keywords: ['shared'] },
  { value: '"JetBrainsMono Nerd Font Mono", monospace', label: 'JetBrainsMono Nerd Font Mono', keywords: ['shared', 'nerd'] },
  { value: '"Cascadia Code", monospace', label: 'Cascadia Code', keywords: ['shared'] },
  { value: '"Cascadia Mono", monospace', label: 'Cascadia Mono', keywords: ['shared'] },
  { value: '"Fira Code", monospace', label: 'Fira Code', keywords: ['shared'] },
  { value: '"Fira Mono", monospace', label: 'Fira Mono', keywords: ['shared'] },
  { value: '"Source Code Pro", monospace', label: 'Source Code Pro', keywords: ['shared'] },
  { value: '"IBM Plex Mono", monospace', label: 'IBM Plex Mono', keywords: ['shared'] },
  { value: '"Iosevka", monospace', label: 'Iosevka', keywords: ['shared'] },
  { value: '"Hack", monospace', label: 'Hack', keywords: ['shared'] },
  { value: '"Ubuntu Mono", monospace', label: 'Ubuntu Mono', keywords: ['shared'] },
  { value: '"Roboto Mono", monospace', label: 'Roboto Mono', keywords: ['shared'] },
  { value: '"Inconsolata", monospace', label: 'Inconsolata', keywords: ['shared'] },
  { value: '"Sarasa Gothic SC", "Sarasa Mono SC", monospace', label: 'Sarasa Gothic SC', keywords: ['shared', '更纱'] },
];

const normalizeFontOptionLabel = (label: string): string => sanitizeFontFamilyInput(label)?.toLowerCase() || '';

const dedupeFontOptions = (options: FontFamilyOption[]): FontFamilyOption[] => {
  const seenLabels = new Set<string>();
  const seenValues = new Set<string>();
  const result: FontFamilyOption[] = [];
  options.forEach((option) => {
    const normalizedValue = sanitizeFontFamilyInput(option.value);
    const normalizedLabel = normalizeFontOptionLabel(option.label);
    if (!normalizedValue) {
      return;
    }
    if ((normalizedLabel && seenLabels.has(normalizedLabel)) || seenValues.has(normalizedValue)) {
      return;
    }
    if (normalizedLabel) {
      seenLabels.add(normalizedLabel);
    }
    seenValues.add(normalizedValue);
    result.push({
      value: normalizedValue,
      label: option.label,
      labelKey: option.labelKey,
      isDefault: option.isDefault,
      keywords: option.keywords,
    });
  });
  return result;
};

const localizeFontOptions = (
  options: FontFamilyOption[],
  translate?: FontFamilyLabelTranslator,
): FontFamilyOption[] => {
  if (!translate) {
    return options;
  }
  return options.map((option) => ({
    ...option,
    label: option.labelKey ? translate(option.labelKey) : option.label,
  }));
};

const sortFontOptions = (options: FontFamilyOption[]): FontFamilyOption[] => {
  const defaultOptions: FontFamilyOption[] = [];
  const regularOptions: FontFamilyOption[] = [];
  options.forEach((option) => {
    if (option.isDefault) {
      defaultOptions.push(option);
      return;
    }
    regularOptions.push(option);
  });
  regularOptions.sort((left, right) => left.label.localeCompare(right.label, undefined, {
    sensitivity: 'base',
    numeric: true,
  }));
  return [...defaultOptions, ...regularOptions];
};

const escapeFontFamilyName = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"');

const formatInstalledFontLabel = (family: string): string => sanitizeFontFamilyInput(
  insertFontNameWordBreaks(family),
) || family;

const normalizeInstalledFontFamilyName = (entry: string | InstalledFontFamily): string | null => {
  const family = typeof entry === 'string' ? entry : entry.family;
  return sanitizeFontFamilyInput(family);
};

const buildInstalledFontKeywords = (family: string): string[] => {
  const label = formatInstalledFontLabel(family);
  const tokens = family
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter(Boolean);
  const labelTokens = label
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .filter(Boolean);
  return Array.from(new Set([
    ...tokens,
    ...labelTokens,
    family.toLowerCase(),
    label.toLowerCase(),
    normalizeFontSearchToken(family),
    normalizeFontSearchToken(label),
  ].filter(Boolean)));
};

const buildInstalledFontValue = (family: string, kind: 'ui' | 'mono'): string => {
  const fallback = kind === 'ui' ? UI_FONT_FALLBACK_STACK : MONO_FONT_FALLBACK_STACK;
  return `"${escapeFontFamilyName(family)}", ${fallback}`;
};

const scoreInstalledMonoFamily = (family: string): number => {
  const normalized = family.toLowerCase();
  return MONO_FONT_PRIORITY_HINTS.reduce((score, hint) => (
    normalized.includes(hint) ? score + 10 : score
  ), 0);
};

const buildInstalledFontOptions = (
  installedFamilies: Array<string | InstalledFontFamily>,
  kind: 'ui' | 'mono',
): FontFamilyOption[] => {
  const familyNames: string[] = [];
  const seenFamilies = new Set<string>();

  installedFamilies.forEach((entry) => {
    const family = normalizeInstalledFontFamilyName(entry);
    if (!family) {
      return;
    }
    const dedupeKey = family.toLowerCase();
    if (seenFamilies.has(dedupeKey)) {
      return;
    }
    seenFamilies.add(dedupeKey);
    familyNames.push(family);
  });

  familyNames.sort((left, right) => {
    if (kind === 'mono') {
      const scoreDiff = scoreInstalledMonoFamily(right) - scoreInstalledMonoFamily(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
    }
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  });

  return familyNames.map((family) => ({
    value: buildInstalledFontValue(family, kind),
    label: formatInstalledFontLabel(family),
    keywords: ['installed', ...buildInstalledFontKeywords(family)],
  }));
};

export const sanitizeFontFamilyInput = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_FONT_FAMILY_LENGTH);
};

export const resolveUIFontFamily = (customValue: unknown): string => {
  return sanitizeFontFamilyInput(customValue) ?? DEFAULT_UI_FONT_FAMILY;
};

export const resolveMonoFontFamily = (customValue: unknown): string => {
  return sanitizeFontFamilyInput(customValue) ?? DEFAULT_MONO_FONT_FAMILY;
};

export const hasInstalledCJKFontFamily = (
  installedFamilies: Array<string | InstalledFontFamily>,
): boolean => {
  return installedFamilies.some((entry) => {
    const family = normalizeInstalledFontNameForCJK(entry);
    if (!family) {
      return false;
    }
    const compactFamily = normalizeFontSearchToken(family);
    return CJK_FONT_KEYWORDS.some((keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      return family.includes(normalizedKeyword) || compactFamily.includes(normalizeFontSearchToken(normalizedKeyword));
    });
  });
};

export const getLinuxCJKFontInstallHint = (
  platform: string,
  installedFamilies: Array<string | InstalledFontFamily>,
): string | null => {
  if (String(platform || '').toLowerCase() !== 'linux') {
    return null;
  }
  return hasInstalledCJKFontFamily(installedFamilies) ? null : LINUX_CJK_FONT_INSTALL_COMMAND;
};

export const getPlatformFontFamilyOptions = (
  platform: string,
  kind: "ui" | "mono",
  translate?: FontFamilyLabelTranslator,
): FontFamilyOption[] => {
  const normalizedPlatform = String(platform || "").toLowerCase();
  const platformOptions =
    normalizedPlatform === "windows"
      ? (kind === "ui" ? WINDOWS_UI_FONTS : WINDOWS_MONO_FONTS)
      : normalizedPlatform === "darwin"
        ? (kind === "ui" ? MAC_UI_FONTS : MAC_MONO_FONTS)
        : normalizedPlatform === "linux"
          ? (kind === "ui" ? LINUX_UI_FONTS : LINUX_MONO_FONTS)
          : [];
  return localizeFontOptions(sortFontOptions(dedupeFontOptions([
    ...platformOptions,
    ...(kind === "ui" ? SHARED_UI_FONTS : SHARED_MONO_FONTS),
  ])), translate);
};

export const buildFontFamilyOptions = (
  platform: string,
  kind: 'ui' | 'mono',
  installedFamilies: Array<string | InstalledFontFamily>,
  translate?: FontFamilyLabelTranslator,
): FontFamilyOption[] => {
  const presets = getPlatformFontFamilyOptions(platform, kind);
  // 未安装预设仅在字体库展示；选择器不把名称预设当成可用字体。
  return localizeFontOptions(dedupeFontOptions([
    ...presets.filter(option => option.isDefault),
    ...buildInstalledFontOptions(installedFamilies, kind),
  ]), translate);
};

export const matchFontFamilyOption = (
  input: string,
  option?: FontFamilyOption,
): boolean => {
  const normalizedInput = String(input || "").trim().toLowerCase();
  const compactInput = normalizeFontSearchToken(normalizedInput);
  if (!normalizedInput) {
    return true;
  }
  if (!option) {
    return false;
  }
  return [option.label, option.value, ...(option.keywords || [])].some((entry) => {
    const text = String(entry || '').toLowerCase();
    if (text.includes(normalizedInput)) {
      return true;
    }
    return compactInput ? normalizeFontSearchToken(text).includes(compactInput) : false;
  });
};
