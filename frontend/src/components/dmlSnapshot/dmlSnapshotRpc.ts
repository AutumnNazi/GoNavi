export interface DMLSnapshotRpcResult<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
}

export interface DMLSnapshotBackend {
  ListDMLSnapshots?: () => Promise<DMLSnapshotRpcResult>;
  GetDMLSnapshot?: (id: string) => Promise<DMLSnapshotRpcResult>;
}

// 只有后端 message 才允许直接展示给用户 —— 它经 appText 本地化过。
// 其余异常（方法缺失、网络层失败）是面向开发者的内部字符串，
// 直接透出会把英文内部信息泄漏到界面上，必须由调用方换成本地化兜底文案。
export class DMLSnapshotBackendMessage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DMLSnapshotBackendMessage';
  }
}

// 与 audit/sqlAuditRpc 同一套可注入 backend 模式：
// 面板不直接 import wailsjs 绑定，测试才能绕开 window.go 注入假后端。
export const resolveDMLSnapshotBackend = (): DMLSnapshotBackend => {
  if (typeof window === 'undefined') return {};
  return ((window as any).go?.app?.App || {}) as DMLSnapshotBackend;
};

export const requireDMLSnapshotMethod = <T extends keyof DMLSnapshotBackend>(
  backend: DMLSnapshotBackend,
  method: T,
): NonNullable<DMLSnapshotBackend[T]> => {
  const candidate = backend[method];
  if (typeof candidate !== 'function') {
    throw new Error(`DML snapshot backend method unavailable: ${String(method)}`);
  }
  return candidate as NonNullable<DMLSnapshotBackend[T]>;
};

export const unwrapDMLSnapshotResult = <T>(result: DMLSnapshotRpcResult<T>): T => {
  if (result?.success === false) {
    // 后端已在 message 里给出本地化文案（appText），原样透出。
    const message = String(result.message || '').trim();
    if (message) throw new DMLSnapshotBackendMessage(message);
    throw new Error('DML snapshot request failed');
  }
  return result?.data as T;
};
