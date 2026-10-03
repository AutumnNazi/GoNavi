// issue #1326：可选更新（revision 变化但驱动库版本未变）的弱提示，
// 支持按 expectedRevision「不再提示此版本」；状态持久化在 localStorage。
// 本模块同时收敛「需重装」统一口径：可见的可选更新与强制更新（needsUpdate）
// 同等纳入需重装分组、分组计数与批量重装；已 dismiss 的 revision 除外。

export const OPTIONAL_UPDATE_DISMISS_KEY = 'gonavi.driver.optionalUpdate.dismissedRevision';

/** 最小行形状，避免反向依赖 DriverManagerModal 的 DriverStatusRow。 */
export type DriverReinstallTargetState = {
  builtIn?: boolean;
  needsUpdate?: boolean;
  optionalUpdate?: boolean;
  expectedRevision?: string;
};

export const readOptionalUpdateDismissedRevisions = (): string[] => {
  try {
    const raw = window.localStorage.getItem(OPTIONAL_UPDATE_DISMISS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

export const isOptionalUpdateVisible = (row: DriverReinstallTargetState, dismissedRevisions: string[]): boolean => {
  return !!row.optionalUpdate && !!row.expectedRevision && !dismissedRevisions.includes(row.expectedRevision);
};

/**
 * 「需重装」统一口径：非内置驱动中，强制更新（needsUpdate）或可见的可选更新
 * 都视为重装目标；分组筛选、分组计数、批量重装、列表圆点、详情徽章共用此判定，
 * 避免各处分叉导致「有更新却不进组、不能批量重装」。
 */
export const isDriverReinstallTarget = (row: DriverReinstallTargetState, dismissedRevisions: string[]): boolean => {
  if (row.builtIn) {
    return false;
  }
  return !!row.needsUpdate || isOptionalUpdateVisible(row, dismissedRevisions);
};
