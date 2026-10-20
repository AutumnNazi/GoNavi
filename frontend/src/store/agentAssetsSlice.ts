import { SessionAgentListIntegrations } from '../../wailsjs/go/app/App';
import type { AgentIntegrationSummaryView } from '../utils/agentConnectionTypes';
import type { AppState } from './storeStateTypes';
import type { StoreGet, StoreSet } from './storeSliceTypes';

/**
 * 智能体集成视图状态：主页固定分组与工作台共享的工具摘要。数据来自
 * 已添加的智能体（agents.json）；未添加任何工具时列表为空，侧边栏
 * 「智能体」分组隐藏，唯一入口在新建连接弹窗的智能体分类。
 */
export type AgentAssetsSliceState = Pick<
  AppState,
  'agentIntegrations' | 'agentIntegrationsLoading' | 'refreshAgentIntegrations'
>;

const toSummaries = (payload: unknown): AgentIntegrationSummaryView[] => {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => item as { kind?: string; displayName?: string; dataDir?: string })
    .filter((item): item is { kind: string; displayName?: string; dataDir?: string } =>
      !!item && typeof item.kind === 'string' && item.kind !== '')
    .map((item) => ({
      integrationId: item.kind,
      kind: item.kind,
      displayName: item.displayName || item.kind,
      enabled: true,
      assetCount: 0,
      dataDir: item.dataDir || '',
    }));
};

export const createAgentAssetsSlice = (set: StoreSet, _get: StoreGet): AgentAssetsSliceState => ({
  agentIntegrations: [],
  agentIntegrationsLoading: false,
  refreshAgentIntegrations: async () => {
    set((state) => ({ ...state, agentIntegrationsLoading: true }));
    try {
      const result = await SessionAgentListIntegrations();
      if (result?.success) {
        set((state) => ({
          ...state,
          agentIntegrations: toSummaries(result.data),
          agentIntegrationsLoading: false,
        }));
        return;
      }
    } catch {
      // 后端不可达时保留现有列表，仅复位加载态。
    }
    set((state) => ({ ...state, agentIntegrationsLoading: false }));
  },
});
