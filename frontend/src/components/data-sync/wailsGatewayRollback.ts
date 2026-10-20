import type { WailsDataSyncApi } from './wailsGatewayApi';
import { requireWailsCommandSuccess } from './wailsDto';

export const rollbackDataSyncRun = async (
  api: WailsDataSyncApi,
  runId: string,
): Promise<void> => {
  requireWailsCommandSuccess(
    await api.RollbackDataSyncRun(runId),
    'RollbackDataSyncRun',
  );
};
