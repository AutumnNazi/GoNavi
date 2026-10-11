import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCEMENT_ID_BUILTIN_AI_FREE,
  clearAnnouncementReadState,
  isAnnouncementRead,
  loadReadAnnouncementIds,
  markAnnouncementRead,
  shouldShowBuiltinAIAnnouncement,
} from './announcementReadState';

const readyVisibility = () => ({
  isStoreHydrated: true,
  hasLoadedSecureConfig: true,
  isSecurityUpdateIntroOpen: false,
  isSecurityUpdateProgressOpen: false,
  isRead: false,
});

describe('announcementReadState', () => {
  let memory: Record<string, string>;

  beforeEach(() => {
    memory = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in memory ? memory[key] : null),
      setItem: (key: string, value: string) => {
        memory[key] = String(value);
      },
      removeItem: (key: string) => {
        delete memory[key];
      },
    });
    clearAnnouncementReadState();
  });

  afterEach(() => {
    clearAnnouncementReadState();
    vi.unstubAllGlobals();
  });

  it('marks and loads read announcement ids', () => {
    expect(isAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)).toBe(false);
    expect(markAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)).toBe(true);
    expect(markAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)).toBe(false);
    expect(isAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)).toBe(true);
    expect(loadReadAnnouncementIds().has(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)).toBe(true);
  });

  it('caps the stored ids so an old announcement never blocks a new one', () => {
    for (let index = 0; index < 45; index += 1) {
      markAnnouncementRead(`announcement-${index}`);
    }
    const stored = loadReadAnnouncementIds();
    expect(stored.size).toBe(40);
    expect(stored.has('announcement-44')).toBe(true);
    expect(stored.has('announcement-0')).toBe(false);
  });

  it('shows the announcement only once the shell is ready and no other intro is open', () => {
    expect(shouldShowBuiltinAIAnnouncement(readyVisibility())).toBe(true);
    expect(shouldShowBuiltinAIAnnouncement({ ...readyVisibility(), isStoreHydrated: false })).toBe(false);
    expect(shouldShowBuiltinAIAnnouncement({ ...readyVisibility(), hasLoadedSecureConfig: false })).toBe(false);
    expect(shouldShowBuiltinAIAnnouncement({ ...readyVisibility(), isSecurityUpdateIntroOpen: true })).toBe(false);
    expect(shouldShowBuiltinAIAnnouncement({ ...readyVisibility(), isSecurityUpdateProgressOpen: true })).toBe(false);
    expect(shouldShowBuiltinAIAnnouncement({ ...readyVisibility(), isRead: true })).toBe(false);
  });

  it('keeps other announcement ids independent of this one', () => {
    markAnnouncementRead('another-announcement');
    expect(isAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)).toBe(false);
    expect(shouldShowBuiltinAIAnnouncement(readyVisibility())).toBe(true);
  });
});
