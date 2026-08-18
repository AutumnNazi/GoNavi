import type { RequestTracePage } from './requestDiagnosticsModel';

export interface RequestDiagnosticsRpcResult<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
}

export interface DatabaseDiagnosticRedaction {
  credentials?: string;
  dsn?: string;
  sqlLiterals?: string;
  businessValues?: string;
  sensitivePaths?: string;
}

export interface DatabaseDiagnosticScope {
  included?: string[];
  excluded?: string[];
  redaction?: DatabaseDiagnosticRedaction;
}

export interface DatabaseDiagnosticSourceAvailability {
  connectionState?: string;
  driverTypes?: string[];
  requestTraces?: string;
  slowQueryHistory?: string;
  logs?: string;
  aiSnapshot?: string;
  metadataTiming?: string;
}

export interface DatabaseDiagnosticPreview {
  readOnly?: boolean;
  format?: string;
  scope?: DatabaseDiagnosticScope;
  redaction?: DatabaseDiagnosticRedaction;
  connectionCount?: number;
  requestTraceCount?: number;
  runningQueryCount?: number;
  pendingTransactionCount?: number;
  slowQuerySummaryCount?: number;
  sources?: DatabaseDiagnosticSourceAvailability;
}

export interface DatabaseDiagnosticExportPayload {
  fileName?: string;
  mimeType?: string;
  content?: string;
}

export interface RequestDiagnosticsBackend {
  GetRequestDiagnostics?: (filter: { requestId?: string; entry?: string; limit?: number }) => Promise<RequestDiagnosticsRpcResult<RequestTracePage>>;
  GetDatabaseDiagnosticPackagePreview?: () => Promise<RequestDiagnosticsRpcResult<DatabaseDiagnosticPreview>>;
  BuildDatabaseDiagnosticPackage?: () => Promise<RequestDiagnosticsRpcResult<DatabaseDiagnosticExportPayload>>;
  ExportDatabaseDiagnosticPackage?: () => Promise<RequestDiagnosticsRpcResult<Record<string, string>>>;
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
