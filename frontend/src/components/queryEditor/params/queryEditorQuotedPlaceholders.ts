const QUOTED_PLACEHOLDERS_STORAGE_KEY = 'gonavi.queryParams.quotedPlaceholders';

// 默认开启，保持 '{startDate}'、'{startDate} 00:00:00' 仍是绑定参数。
// 用户关掉后，'{code1}-{code2}' 这类原文不再被收成参数。
export function readQuotedPlaceholdersEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return true;
    }
    return localStorage.getItem(QUOTED_PLACEHOLDERS_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeQuotedPlaceholdersEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(QUOTED_PLACEHOLDERS_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 隐私模式写失败时只保留本次会话状态。
  }
}
