import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ANNOUNCEMENT_ID_BUILTIN_AI_FREE,
  isAnnouncementRead,
  markAnnouncementRead,
  shouldShowBuiltinAIAnnouncement,
} from '../../utils/announcementReadState';

/**
 * 直接读 Wails 绑定而不是引入 AI 设置模块：本 hook 在 App.tsx 顶层被同步引入，
 * 走 aiSettingsModalConfig 会把整棵 AI 设置依赖树拉进主包。
 *
 * 只读本地登录态，不发任何网络请求：
 * - 用 AIGetBuiltinAIProvider 的 hasSecret（后端读 ~/.gonavi/daily_secrets.json，
 *   注释明确为 "reads local state only"），而不用 AIGetBuiltinAIStatus ——
 *   后者会经 fetchBuiltinAIQuota 访问网关，内网用户一启动就产生外联请求。
 * - 顺带修正了一个语义问题：status 在网关不可达时返回 authenticated=false，
 *   会把已登录的内网用户显示成"需要登录"；本地 token 探测没有这个失真。
 */
const readBuiltinAILocalLoginState = async (): Promise<boolean | null> => {
  try {
    const service = typeof window === 'undefined' ? undefined : (window as any).go?.aiservice?.Service;
    if (typeof service?.AIGetBuiltinAIProvider !== 'function') return null;
    const provider = await service.AIGetBuiltinAIProvider();
    return Boolean(provider?.hasSecret);
  } catch {
    return null;
  }
};

/**
 * 本地读取通常很快，这里只防 IPC 异常挂起：公告不是关键路径，但也不该因为一次
 * 卡住的调用永远不出现。超时按未登录处理——对已登录用户多显示一段登录步骤只是
 * 冗余，而把未登录用户误标成"已登录"是错误信息。
 */
const LOCAL_LOGIN_STATE_TIMEOUT_MS = 3000;

const readBuiltinAILocalLoginStateWithTimeout = async (): Promise<boolean | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readBuiltinAILocalLoginState(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOCAL_LOGIN_STATE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export interface UseBuiltinAIAnnouncementInput {
  isStoreHydrated: boolean;
  hasLoadedSecureConfig: boolean;
  isSecurityUpdateIntroOpen: boolean;
  isSecurityUpdateProgressOpen: boolean;
  /** 面板已经开着时不要再 toggle，否则会把用户的面板关掉。 */
  aiPanelVisible: boolean;
  onOpenPanel: () => void;
}

export interface BuiltinAIAnnouncementApi {
  open: boolean;
  signedIn: boolean;
  /** 「我已知晓」：记入本地已读，之后不再出现。 */
  acknowledge: () => void;
  /** 遮罩 / Esc / 关闭按钮：本次只是关掉，下次启动仍会提醒。 */
  dismiss: () => void;
  openPanel: () => void;
}

/**
 * 内置免费 AI 的一次性启动公告。安全更新引导优先：等它关闭后公告才出现，
 * 之后不再自动弹出（「我已知晓」按公告 ID 记入本地已读）。
 */
export const useBuiltinAIAnnouncement = ({
  isStoreHydrated,
  hasLoadedSecureConfig,
  isSecurityUpdateIntroOpen,
  isSecurityUpdateProgressOpen,
  aiPanelVisible,
  onOpenPanel,
}: UseBuiltinAIAnnouncementInput): BuiltinAIAnnouncementApi => {
  const [open, setOpen] = useState(false);
  // null = 尚未读到。弹窗必须等它不是 null 才打开，否则首帧会先按"未登录"渲染、
  // 读到后再整块换成"已登录"，视觉上是一次明显的割裂。
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // 只自动弹一次：同一次运行里不再因为状态变化重新打开。
  const autoOpenedRef = useRef(false);
  // 首次落定即终态：超时兜底先返回时，晚到的真实结果不再回写，避免打开后内容再变。
  const settledRef = useRef(false);

  const settleSignedIn = useCallback((value: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    setSignedIn(value);
  }, []);

  // 查询提前到这里发起（不依赖 isSecurityUpdateIntroOpen），与安全更新引导并行，
  // 使公告真正打开时状态通常已经就绪。
  useEffect(() => {
    if (!isStoreHydrated || !hasLoadedSecureConfig) return undefined;
    if (isAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE)) return undefined;

    let cancelled = false;
    void readBuiltinAILocalLoginStateWithTimeout().then((hasToken) => {
      if (cancelled) return;
      settleSignedIn(Boolean(hasToken));
    });
    return () => {
      cancelled = true;
    };
  }, [hasLoadedSecureConfig, isStoreHydrated, settleSignedIn]);

  useEffect(() => {
    // 已读状态在这里读，而不是在渲染期读 localStorage：App.tsx 每次渲染都会重跑本 hook。
    if (autoOpenedRef.current) return;
    if (signedIn === null) return;
    const shouldShow = shouldShowBuiltinAIAnnouncement({
      isStoreHydrated,
      hasLoadedSecureConfig,
      isSecurityUpdateIntroOpen,
      isSecurityUpdateProgressOpen,
      isRead: isAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE),
    });
    if (!shouldShow) return;
    autoOpenedRef.current = true;
    setOpen(true);
  }, [
    signedIn,
    isStoreHydrated,
    hasLoadedSecureConfig,
    isSecurityUpdateIntroOpen,
    isSecurityUpdateProgressOpen,
  ]);

  const acknowledge = useCallback(() => {
    markAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE);
    setOpen(false);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  const openPanel = useCallback(() => {
    markAnnouncementRead(ANNOUNCEMENT_ID_BUILTIN_AI_FREE);
    setOpen(false);
    if (!aiPanelVisible) onOpenPanel();
  }, [aiPanelVisible, onOpenPanel]);

  return { open, signedIn: Boolean(signedIn), acknowledge, dismiss, openPanel };
};
