import { SessionAgentProviders } from '../../wailsjs/go/app/App';
import type { AgentIntegrationSummaryView } from '../utils/agentConnectionTypes';
import type { AppState } from './storeStateTypes';
import type { StoreGet, StoreSet } from './storeSliceTypes';

/**
 * 智能体集成视图状态：主页固定分组与工作台共享的工具摘要。
 * 会话浏览是纯只读的（不需要启用/禁用），摘要来自支持的工具列表；
 * 会话数由打开工作台后按需查询，不在侧栏常驻。
 */
export type AgentAssetsSliceState = Pick<
  AppState,
  'agentIntegrations' | 'agentIntegrationsLoading' | 'refreshAgentIntegrations'
>;

const toSummaries = (payload: unknown): AgentIntegrationSummaryView[] => {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => item as { id?: string; name?: string })
    .filter((item): item is { id: string; name?: string } => !!item && typeof item.id === 'string' && item.id !== '')
    .map((item) => ({
      integrationId: item.id,
      kind: item.id,
      displayName: item.name || item.id,
      enabled: true,
      assetCount: 0,
    }));
};

export const createAgentAssetsSlice = (set: StoreSet, _get: StoreGet): AgentAssetsSliceState => ({
  agentIntegrations: [],
  agentIntegrationsLoading: false,
  refreshAgentIntegrations: async () => {
    set((state) => ({ ...state, agentIntegrationsLoading: true }));
    try {
      const result = await SessionAgentProviders();
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
