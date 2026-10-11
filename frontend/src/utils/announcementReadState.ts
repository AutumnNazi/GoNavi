/**
 * 记录「已读」的启动公告，用户点「我已知晓」后不再重复弹出。
 * 按公告 ID 而非布尔开关记录，将来发新公告只需换 ID 即可再次触达。
 */

const STORAGE_KEY = 'gonavi.announcement.readIds.v1';
const MAX_KEYS = 40;

/** 内置免费 AI 公告（GoNavi 1.1.0 起提供）。 */
export const ANNOUNCEMENT_ID_BUILTIN_AI_FREE = 'builtin-ai-free-1.1.0';

const readStorage = (): string[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
};

const writeStorage = (keys: string[]): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(0, MAX_KEYS)));
  } catch {
    // ignore quota / private mode
  }
};

export const loadReadAnnouncementIds = (): Set<string> => new Set(readStorage());

export const isAnnouncementRead = (id: string): boolean => {
  const normalized = String(id || '').trim();
  if (!normalized) return false;
  return loadReadAnnouncementIds().has(normalized);
};

/** 标记已读；返回是否状态发生变化。 */
export const markAnnouncementRead = (id: string): boolean => {
  const normalized = String(id || '').trim();
  if (!normalized) return false;
  const current = readStorage();
  if (current.includes(normalized)) return false;
  writeStorage([normalized, ...current.filter((item) => item !== normalized)]);
  return true;
};

export const clearAnnouncementReadState = (): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

export interface BuiltinAIAnnouncementVisibilityInput {
  /** 本地持久化尚未 hydrate 时不要弹，避免与首屏抢焦点。 */
  isStoreHydrated: boolean;
  /** 安全配置加载完成前不弹，此时界面仍在铺底。 */
  hasLoadedSecureConfig: boolean;
  /** 安全更新引导弹窗优先，它开着时公告让位。 */
  isSecurityUpdateIntroOpen: boolean;
  isSecurityUpdateProgressOpen: boolean;
  /** 本条公告是否已被「我已知晓」记入本地已读。 */
  isRead: boolean;
}

/**
 * 是否显示内置免费 AI 公告。安全更新引导优先于公告：它关闭后本函数才返回 true，
 * 调用方因此无需自己编排两个弹窗的先后。
 */
export const shouldShowBuiltinAIAnnouncement = (
  input: BuiltinAIAnnouncementVisibilityInput,
): boolean => {
  if (!input.isStoreHydrated || !input.hasLoadedSecureConfig) return false;
  if (input.isSecurityUpdateIntroOpen || input.isSecurityUpdateProgressOpen) return false;
  return !input.isRead;
};
