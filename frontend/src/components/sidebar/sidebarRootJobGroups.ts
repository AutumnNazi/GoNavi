import type { SavedConnection } from '../../types';
import type { DatabaseJobsResult } from './sidebarDatabaseJobs';
import type { SidebarTreeNode } from './sidebarV2TreeNodes';
import { usesSchemaScopedDatabaseJobs } from '../../utils/databaseJobs/jobCapabilities';
import { buildDatabaseJobGroup } from './sidebarJobObjects';

/** Schedulers belonging to a database/instance are not placed into invented schema buckets. */
export const buildRootDatabaseJobGroups = (
  conn: SavedConnection & { dbName?: string }, parentKey: string, result: DatabaseJobsResult,
): SidebarTreeNode[] => (
  !usesSchemaScopedDatabaseJobs(conn.config) && result.supported
    ? [buildDatabaseJobGroup(conn, parentKey, result.jobs)] : []
);
