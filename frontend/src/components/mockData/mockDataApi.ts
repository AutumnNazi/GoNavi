import {
  CancelQuery,
  MockDataGenerate,
  MockDataInspect,
  MockDataPreview,
} from '../../../wailsjs/go/app/App';
import { app, connection, mockdata } from '../../../wailsjs/go/models';
import type { ConnectionConfig } from '../../types';
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig';
import type {
  MockDataInspection,
  MockDataPlan,
  MockDataPreviewResult,
  MockDataRunResult,
} from './mockDataModel';

export type MockDataTarget = {
  config: ConnectionConfig;
  dbName: string;
  tableName: string;
};

export type MockDataCallResult<T> = {
  success: boolean;
  message: string;
  data?: T;
};

const toRpcConfig = (config: ConnectionConfig) => connection.ConnectionConfig.createFrom(buildRpcConnectionConfig(config));

const toCallResult = <T>(result: connection.QueryResult | undefined): MockDataCallResult<T> => ({
  success: result?.success === true,
  message: String(result?.message || ''),
  data: result?.data as T | undefined,
});

export const inspectMockDataTable = async (target: MockDataTarget, locale: string) => (
  toCallResult<MockDataInspection>(await MockDataInspect(toRpcConfig(target.config), target.dbName, target.tableName, locale))
);

export const previewMockData = async (target: MockDataTarget, plan: MockDataPlan) => (
  toCallResult<MockDataPreviewResult>(
    await MockDataPreview(toRpcConfig(target.config), target.dbName, target.tableName, mockdata.Plan.createFrom(plan)),
  )
);

export const generateMockData = async (
  target: MockDataTarget,
  plan: MockDataPlan,
  options: { jobId: string; continueOnError: boolean },
) => toCallResult<MockDataRunResult>(
  await MockDataGenerate(
    toRpcConfig(target.config),
    target.dbName,
    target.tableName,
    mockdata.Plan.createFrom(plan),
    app.MockDataRunOptions.createFrom(options),
  ),
);

export const cancelMockDataJob = (jobId: string): void => {
  void Promise.resolve(CancelQuery(jobId)).catch(() => undefined);
};
