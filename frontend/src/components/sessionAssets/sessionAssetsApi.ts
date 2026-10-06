import { SessionAssetsContinueSession, SessionAssetsPreviewHandoff, SessionAssetsDeleteAsset, SessionAssetsExportAsset, SessionAssetsGetAssetDetail, SessionAssetsHandoffCapability, SessionAssetsLaunchInteractive, SessionAssetsListAssets, SessionAssetsPrepareHandoff, SessionAssetsReadHistory, SessionAssetsRefreshSources } from '../../../wailsjs/go/app/App';

/**
 * 会话资产前端 API seam：组件依赖本接口而非直接绑定，便于测试注入
 * （参照 data-sync/wailsGatewayApi 模式）。
 */
export interface SessionAssetsListFilter {
  query: string;
  backupStatus: string;
  page: number;
  pageSize: number;
}

export interface SessionAssetView {
  id: string;
  nativeThreadId: string;
  title: string;
  projectDir: string;
  provider: string;
  model: string;
  updatedAt: number;
  sourceStatus: string;
  backupStatus: string;
  materialStatus: string;
  latestComplete: boolean;
  lastBackupAt: number;
  hasBackup: boolean;
}

export interface SessionAssetDetail extends SessionAssetView {
  readSource: 'live' | 'backup' | 'missing';
  readPath: string;
  coverageAt: number;
  sourceRefs: Array<{ sourceId: string; nativePath: string; sourceStatus: string }>;
  materialFiles: Array<{ relPath: string; size: number; sha256: string; role: string }>;
  ancestors: Array<{ nativeThreadId: string; boundaryAt: number }>;
  attachments: Array<{ name: string; disposition: string; relPath?: string }>;
  missing: Array<{ reason: string; detail: string }>;
}

export interface SessionHistoryEntry {
  index: number;
  kind: string;
  role?: string;
  name?: string;
  callId?: string;
  text?: string;
  timestamp?: string;
  opaque?: boolean;
}

export interface SessionHistoryPage {
  entries: SessionHistoryEntry[];
  nextOffset: number;
  hasMore: boolean;
  readSource: string;
}

export type SessionAssetsApi = {
  listAssets(kind: string, filter: SessionAssetsListFilter): Promise<{ items: SessionAssetView[]; total: number } | null>;
  getAssetDetail(assetId: string): Promise<SessionAssetDetail | null>;
  readHistory(assetId: string, offset: number, limit: number): Promise<SessionHistoryPage | null>;
  exportAsset(assetId: string, mode: 'raw' | 'readable'): Promise<{ file?: string } | null>;
  deleteAsset(assetId: string): Promise<boolean>;
  refreshSources(kind: string): Promise<boolean>;
  continueSession(assetId: string): Promise<{ stage: string } | null>;
  launchInteractive(workDir: string): Promise<{ stage: string } | null>;
  prepareHandoff(assetId: string, workDir: string, mode: string, from: number, to: number, currentRequest: string): Promise<{ stage: string; noteFile?: string; materialsDir?: string } | null>;
  getCapability(assetId: string): Promise<{ nativeResume: boolean; newSession: boolean; manualMaterial: boolean; historyProvider?: string; currentProvider?: string } | null>;
  previewHandoff(assetId: string, mode: string, from: number, to: number): Promise<Record<string, unknown> | null>;
};

const unwrap = <T,>(result: { success?: boolean; data?: unknown } | null | undefined): T | null =>
  result?.success ? ((result.data ?? null) as T | null) : null;

export const wailsSessionAssetsApi: SessionAssetsApi = {
  async listAssets(kind, filter) {
    return unwrap<{ items: SessionAssetView[]; total: number }>(
      await SessionAssetsListAssets(kind, {
        query: filter.query,
        backupStatus: filter.backupStatus,
        sourceId: '',
        projectDir: '',
        provider: '',
        sourceStatus: '',
        page: filter.page,
        pageSize: filter.pageSize,
      }),
    );
  },
  async getAssetDetail(assetId) {
    return unwrap<SessionAssetDetail>(await SessionAssetsGetAssetDetail(assetId));
  },
  async readHistory(assetId, offset, limit) {
    const result = await SessionAssetsReadHistory(assetId, offset, limit);
    if (!result?.success) return null;
    return {
      entries: (Array.isArray(result.data?.entries) ? result.data.entries : []) as SessionHistoryEntry[],
      nextOffset: Number(result.data?.nextOffset ?? 0),
      hasMore: Boolean(result.data?.hasMore),
      readSource: String(result.data?.readSource ?? ''),
    };
  },
  async exportAsset(assetId, mode) {
    return unwrap<{ file?: string }>(await SessionAssetsExportAsset(assetId, mode, ''));
  },
  async deleteAsset(assetId) {
    const result = await SessionAssetsDeleteAsset(assetId);
    return Boolean(result?.success);
  },
  async refreshSources(kind) {
    const result = await SessionAssetsRefreshSources(kind);
    return Boolean(result?.success);
  },
  async continueSession(assetId) {
    return unwrap<{ stage: string }>(await SessionAssetsContinueSession(assetId));
  },
  async launchInteractive(workDir) {
    return unwrap<{ stage: string }>(await SessionAssetsLaunchInteractive(workDir));
  },
  async previewHandoff(assetId, mode, from, to) {
    return unwrap<Record<string, unknown>>(await SessionAssetsPreviewHandoff(assetId, mode, from, to));
  },
  async prepareHandoff(assetId, workDir, mode, from, to, currentRequest) {
    return unwrap<{ stage: string; noteFile?: string; materialsDir?: string }>(
      await SessionAssetsPrepareHandoff(assetId, workDir, mode, from, to, currentRequest),
    );
  },
  async getCapability(assetId) {
    return unwrap<{ nativeResume: boolean; newSession: boolean; manualMaterial: boolean; historyProvider?: string; currentProvider?: string }>(
      await SessionAssetsHandoffCapability(assetId),
    );
  },
};
