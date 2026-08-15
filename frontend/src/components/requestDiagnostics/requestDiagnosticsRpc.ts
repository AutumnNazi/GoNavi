import type { RequestTracePage } from './requestDiagnosticsModel';

export interface RequestDiagnosticsRpcResult<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
}

export interface RequestDiagnosticsBackend {
  GetRequestDiagnostics?: (filter: { requestId?: string; entry?: string; limit?: number }) => Promise<RequestDiagnosticsRpcResult<RequestTracePage>>;
}

export const resolveRequestDiagnosticsBackend = (): RequestDiagnosticsBackend => {
  if (typeof window === 'undefined') return {};
  return ((window as any).go?.app?.App || {}) as RequestDiagnosticsBackend;
};

export const unwrapRequestDiagnostics = <T>(result: RequestDiagnosticsRpcResult<T>): T => {
  if (result?.success === false) {
    throw new Error(String(result.message || '').trim() || 'Request diagnostics failed');
  }
  return result?.data as T;
};
