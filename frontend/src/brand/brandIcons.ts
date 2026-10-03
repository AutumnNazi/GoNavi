export type BrandIconId =
  | '01'
  | '02'
  | '03'
  | '04'
  | '05'
  | '06'
  | '07'
  | '08'
  | '09'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15'
  | '16';

export type BrandIconDefinition = {
  id: BrandIconId;
  slug: string;
  titleZh: string;
  titleEn: string;
  iconPath: string;
  aboutPath: string;
  titlebarPath?: string;
  /** Asset is shipped with the frontend instead of fetched from the mirror. */
  bundled?: boolean;
};

export const DEFAULT_BRAND_ICON_ID: BrandIconId = '01';
// The remote ribbon SVGs frame their tile at ~80% of the rendered canvas
// (measured 0.797-0.805 across 01-06, designers keep a breathing margin).
// Bundled mascot previews must size their white tile to the same fraction so
// every option reads as the same tile size in the picker.
export const RIBBON_TILE_ART_FRACTION = 0.8;
// The bundled 0.9.7 mascot artworks leave 7–10% vertical and 11–24%
// horizontal white margins inside their 512px tiles (smallest measured margin
// is 34px). A 1.13× centre crop is the largest uniform zoom that never clips
// the artwork and keeps the mascot mark comparable to the ribbon marks at
// small sizes, so previews and native taskbar icons share the same framing.
export const BUNDLED_BRAND_ICON_ZOOM = 1.13;
export const BRAND_ICON_REMOTE_BASE_URL = 'https://origin-download.syngnat.top:8443/gonavi/brand-assets/v1';
export const BRAND_ICON_FALLBACK_SRC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI0IiBmaWxsPSIjMTYxYzJhIi8+PHBhdGggZD0iTTI0IDM0aDgwYzAgMjAtMTIgMjktMjkgMjktMTcgMC0yOS05LTI5LTI5bDI5IDBjMTcgMCAyOS05IDI5LTI5em0wIDYwYzE3IDAgMjktOSAyOS0yOWgyMmMwIDIwLTEyIDI5LTI5IDI5LTE3IDAtMjktOS0yOS0yOWgyMmMwIDIwIDEyIDI5IDI5IDI5eiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==';

const loadedBrandIconSources = new Map<BrandIconId, string>();

export const BRAND_ICONS: BrandIconDefinition[] = [
  {
    id: '01',
    slug: 'ribbon-graphite-air',
    titleZh: '石墨碳白',
    titleEn: 'Graphite air',
    iconPath: '/brand-fallback.svg',
    aboutPath: '/brand-fallback.svg',
    bundled: true,
  },
  {
    id: '02',
    slug: 'ribbon-graphite',
    titleZh: '石墨商务',
    titleEn: 'Graphite business',
    iconPath: BRAND_ICON_FALLBACK_SRC,
    aboutPath: BRAND_ICON_FALLBACK_SRC,
  },
  {
    id: '03',
    slug: 'ribbon-graphite-glow',
    titleZh: '石墨冷蓝',
    titleEn: 'Graphite glow',
    iconPath: BRAND_ICON_FALLBACK_SRC,
    aboutPath: BRAND_ICON_FALLBACK_SRC,
    titlebarPath: BRAND_ICON_FALLBACK_SRC,
  },
  {
    id: '04',
    slug: 'ribbon-indigo-light',
    titleZh: '浅底深紫',
    titleEn: 'Indigo light',
    iconPath: BRAND_ICON_FALLBACK_SRC,
    aboutPath: BRAND_ICON_FALLBACK_SRC,
  },
  {
    id: '05',
    slug: 'ribbon-graphite-light',
    titleZh: '浅底石墨',
    titleEn: 'Graphite on light',
    iconPath: BRAND_ICON_FALLBACK_SRC,
    aboutPath: BRAND_ICON_FALLBACK_SRC,
  },
  {
    id: '06',
    slug: 'ribbon-lilac-dark',
    titleZh: '石墨浅紫',
    titleEn: 'Lilac on graphite',
    iconPath: BRAND_ICON_FALLBACK_SRC,
    aboutPath: BRAND_ICON_FALLBACK_SRC,
  },
  {
    id: '07',
    slug: 'database-hug',
    titleZh: '抱库小狗',
    titleEn: 'Database hug',
    iconPath: '/brand-icons/07-database-hug.webp',
    aboutPath: '/brand-icons/07-database-hug-about.png',
    bundled: true,
  },
  {
    id: '08',
    slug: 'database-search',
    titleZh: '搜库小狗',
    titleEn: 'Database search',
    iconPath: '/brand-icons/08-database-search.webp',
    aboutPath: '/brand-icons/08-database-search-about.png',
    titlebarPath: '/brand-marks/08-database-search-transparent.png',
    bundled: true,
  },
  {
    id: '09',
    slug: 'bandana-badge',
    titleZh: '头巾徽章',
    titleEn: 'Bandana badge',
    iconPath: '/brand-icons/09-bandana-badge.webp',
    aboutPath: '/brand-icons/09-bandana-badge-about.png',
    bundled: true,
  },
  {
    id: '10',
    slug: 'magnifier-wink',
    titleZh: '放大镜眨眼',
    titleEn: 'Magnifier wink',
    iconPath: '/brand-icons/10-magnifier-wink.webp',
    aboutPath: '/brand-icons/10-magnifier-wink-about.png',
    bundled: true,
  },
  {
    id: '11',
    slug: 'window-peek',
    titleZh: '窗口探头',
    titleEn: 'Window peek',
    iconPath: '/brand-icons/11-window-peek.webp',
    aboutPath: '/brand-icons/11-window-peek-about.png',
    bundled: true,
  },
  {
    id: '12',
    slug: 'hex-collar',
    titleZh: '六边项圈',
    titleEn: 'Hex collar',
    iconPath: '/brand-icons/12-hex-collar.webp',
    aboutPath: '/brand-icons/12-hex-collar-about.png',
    bundled: true,
  },
  {
    id: '13',
    slug: 'graph-sit',
    titleZh: '关系图',
    titleEn: 'Graph sit',
    iconPath: '/brand-icons/13-graph-sit.webp',
    aboutPath: '/brand-icons/13-graph-sit-about.png',
    bundled: true,
  },
  {
    id: '14',
    slug: 'cloud-banner',
    titleZh: '云朵横幅',
    titleEn: 'Cloud banner',
    iconPath: '/brand-icons/14-cloud-banner.webp',
    aboutPath: '/brand-icons/14-cloud-banner-about.png',
    bundled: true,
  },
  {
    id: '15',
    slug: 'terminal-sit',
    titleZh: '终端旁坐',
    titleEn: 'Terminal sit',
    iconPath: '/brand-icons/15-terminal-sit.webp',
    aboutPath: '/brand-icons/15-terminal-sit-about.png',
    bundled: true,
  },
  {
    id: '16',
    slug: 'compass-bandana',
    titleZh: '罗盘头巾',
    titleEn: 'Compass bandana',
    iconPath: '/brand-icons/16-compass-bandana.webp',
    aboutPath: '/brand-icons/16-compass-bandana-about.png',
    bundled: true,
  },
];

const BRAND_ICON_BY_ID = new Map(BRAND_ICONS.map((item) => [item.id, item]));

export function sanitizeBrandIconId(value: unknown): BrandIconId {
  const raw = String(value || '').trim();
  if (BRAND_ICON_BY_ID.has(raw as BrandIconId)) {
    return raw as BrandIconId;
  }
  return DEFAULT_BRAND_ICON_ID;
}

export function resolveBrandIcon(id?: unknown): BrandIconDefinition {
  return BRAND_ICON_BY_ID.get(sanitizeBrandIconId(id)) || BRAND_ICONS[0];
}

/** Browser-only harnesses use the same immutable assets as the native cache;
 * bundled compatibility icons resolve to their local frontend asset. */
export function resolveBrandIconRemoteSrc(id?: unknown): string {
  const raw = String(id || '').trim() as BrandIconId;
  const definition = BRAND_ICON_BY_ID.get(raw);
  if (!definition) return '';
  if (definition.bundled) return definition.iconPath;
  return `${BRAND_ICON_REMOTE_BASE_URL}/${definition.id}-${definition.slug}.svg`;
}

export function resolveBrandIconSrc(id?: unknown): string {
  const definition = resolveBrandIcon(id);
  return loadedBrandIconSources.get(definition.id) || definition.iconPath;
}

export function resolveBrandFullSrc(id?: unknown): string {
  return resolveBrandIconSrc(id);
}

export function resolveBrandAboutSrc(id?: unknown): string {
  const definition = resolveBrandIcon(id);
  return definition.bundled ? definition.aboutPath : resolveBrandIconSrc(id);
}

export function resolveBrandTitlebarSrc(id?: unknown): string {
  const definition = resolveBrandIcon(id);
  return definition.bundled && definition.titlebarPath
    ? definition.titlebarPath
    : resolveBrandIconSrc(id);
}

/**
 * Native OS surfaces must wait for a verified remote asset. Sending the
 * shared UI fallback first makes Windows cache that placeholder as the
 * taskbar icon while the real asset update is still queued. Bundled
 * compatibility assets are already verified by being shipped with the app.
 */
export function resolveBrandDockSrc(id?: unknown): string {
  const definition = resolveBrandIcon(id);
  return loadedBrandIconSources.get(definition.id) || (definition.bundled ? definition.iconPath : '');
}

export function setLoadedBrandIconSources(sources: Partial<Record<BrandIconId, string>>): void {
  for (const icon of BRAND_ICONS) {
    const source = String(sources[icon.id] || '').trim();
    if (source) loadedBrandIconSources.set(icon.id, source);
  }
}
