import { SessionAssetsListIntegrations } from '../../wailsjs/go/app/App';
import type { AgentIntegrationSummaryView } from '../utils/agentConnectionTypes';
import type { AppState } from './storeStateTypes';
import type { StoreGet, StoreSet } from './storeSliceTypes';

/**
 * 智能体集成视图状态：主页固定分组与工作台共享的集成摘要。
 * 只缓存列表与加载标记，不保存会话正文或备份内容。
 */
export type AgentAssetsSliceState = Pick<
  AppState,
  'agentIntegrations' | 'agentIntegrationsLoading' | 'refreshAgentIntegrations'
>;

const toSummaries = (payload: unknown): AgentIntegrationSummaryView[] => {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => item as AgentIntegrationSummaryView)
    .filter((item) => !!item && typeof item.integrationId === 'string' && item.integrationId !== '');
};

export const createAgentAssetsSlice = (set: StoreSet, _get: StoreGet): AgentAssetsSliceState => ({
  agentIntegrations: [],
  agentIntegrationsLoading: false,
  refreshAgentIntegrations: async () => {
    set((state) => ({ ...state, agentIntegrationsLoading: true }));
    try {
      const result = await SessionAssetsListIntegrations();
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
