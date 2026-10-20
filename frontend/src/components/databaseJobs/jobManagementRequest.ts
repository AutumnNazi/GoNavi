import type { JobOperation, ManagedJobKind } from '../../utils/databaseJobs/jobManagementTypes';

export type JobManagementRequest = {
  connectionId: string;
  database: string;
  owner: string;
  name: string;
  kind: ManagedJobKind;
  operation: JobOperation;
  onChanged?: () => void | Promise<unknown>;
};
