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
  | '10';

export type BrandIconDefinition = {
  id: BrandIconId;
  slug: string;
  titleZh: string;
  titleEn: string;
  iconPath: string;
  aboutPath: string;
  titlebarPath?: string;
};

export const DEFAULT_BRAND_ICON_ID: BrandIconId = '02';

export const BRAND_ICONS: BrandIconDefinition[] = [
  {
    id: '01',
    slug: 'database-hug',
    titleZh: '抱库小狗',
    titleEn: 'Database hug',
    iconPath: '/brand-icons/01-database-hug.webp',
    aboutPath: '/brand-icons/01-database-hug-about.png',
  },
  {
    id: '02',
    slug: 'database-search',
    titleZh: '搜库小狗',
    titleEn: 'Database search',
    iconPath: '/brand-icons/02-database-search.webp',
    aboutPath: '/brand-icons/02-database-search-about.png',
    titlebarPath: '/brand-marks/02-database-search-transparent.png',
  },
  {
    id: '03',
    slug: 'bandana-badge',
    titleZh: '头巾徽章',
    titleEn: 'Bandana badge',
    iconPath: '/brand-icons/03-bandana-badge.webp',
    aboutPath: '/brand-icons/03-bandana-badge-about.png',
  },
  {
    id: '04',
    slug: 'magnifier-wink',
    titleZh: '放大镜眨眼',
    titleEn: 'Magnifier wink',
    iconPath: '/brand-icons/04-magnifier-wink.webp',
    aboutPath: '/brand-icons/04-magnifier-wink-about.png',
  },
  {
    id: '05',
    slug: 'window-peek',
    titleZh: '窗口探头',
    titleEn: 'Window peek',
    iconPath: '/brand-icons/05-window-peek.webp',
    aboutPath: '/brand-icons/05-window-peek-about.png',
  },
  {
    id: '06',
    slug: 'hex-collar',
    titleZh: '六边项圈',
    titleEn: 'Hex collar',
    iconPath: '/brand-icons/06-hex-collar.webp',
    aboutPath: '/brand-icons/06-hex-collar-about.png',
  },
  {
    id: '07',
    slug: 'graph-sit',
    titleZh: '关系图',
    titleEn: 'Graph sit',
    iconPath: '/brand-icons/07-graph-sit.webp',
    aboutPath: '/brand-icons/07-graph-sit-about.png',
  },
  {
    id: '08',
    slug: 'cloud-banner',
    titleZh: '云朵横幅',
    titleEn: 'Cloud banner',
    iconPath: '/brand-icons/08-cloud-banner.webp',
    aboutPath: '/brand-icons/08-cloud-banner-about.png',
  },
  {
    id: '09',
    slug: 'terminal-sit',
    titleZh: '终端旁坐',
    titleEn: 'Terminal sit',
    iconPath: '/brand-icons/09-terminal-sit.webp',
    aboutPath: '/brand-icons/09-terminal-sit-about.png',
  },
  {
    id: '10',
    slug: 'compass-bandana',
    titleZh: '罗盘头巾',
    titleEn: 'Compass bandana',
    iconPath: '/brand-icons/10-compass-bandana.webp',
    aboutPath: '/brand-icons/10-compass-bandana-about.png',
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
  return BRAND_ICON_BY_ID.get(sanitizeBrandIconId(id)) || BRAND_ICONS[1];
}

export function resolveBrandIconSrc(id?: unknown): string {
  return resolveBrandIcon(id).iconPath;
}

export function resolveBrandFullSrc(id?: unknown): string {
  return resolveBrandIconSrc(id);
}

export function resolveBrandAboutSrc(id?: unknown): string {
  return resolveBrandIcon(id).aboutPath;
}

export function resolveBrandTitlebarSrc(id?: unknown): string {
  const icon = resolveBrandIcon(id);
  return icon.titlebarPath || icon.iconPath;
}

/** Dock uses the exact lossless WebP lockup rendered by BrandIconPicker. */
export function resolveBrandDockSrc(id?: unknown): string {
  return resolveBrandIconSrc(id);
}
