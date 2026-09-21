import React from 'react';
import { AppstoreOutlined, FolderOpenOutlined } from '@ant-design/icons';

import { t } from '../../i18n';
import {
  NACOS_SERVICE_GROUP_PAGE_SIZE,
  parseNacosServiceName,
  walkNacosServicePages,
} from '../nacosServiceName';
import {
  createNacosServiceScan,
  foldNacosServiceScanPage,
  sortNacosServiceGroups,
} from './nacosServiceGroupSummary';

type LoadNacosServiceGroupsArgs = {
  node: any;
  options?: { force?: boolean };
  nacosServiceGroupRequestIdsRef: React.MutableRefObject<Record<string, number>>;
  loadingNodesRef: React.MutableRefObject<Set<string>>;
  setLoadedKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  replaceTreeNodeChildren: (key: React.Key, children: any[] | undefined, dataRef?: unknown) => any[];
  buildRpcConnectionConfig: (config: any) => any;
  getConnectionLoadEpoch: (connectionId: string) => number;
  beginLoadGeneration: (loadKey: string) => number;
  isCurrentConnectionLoadEpoch: (connectionId: string, epoch: number) => boolean;
  isCurrentLoadGeneration: (loadKey: string, generation: number) => boolean;
  showError: (payload: { content: React.ReactNode; key: string }) => void;
  listServices: (
    rpcConfig: unknown,
    query: Record<string, unknown>,
  ) => Promise<{ success?: boolean; message?: string; data?: unknown }>;
};

/**
 * Loads a Nacos namespace's service groups into the sidebar tree.
 *
 * Extracted out of useSidebarTreeLoaders so that hook stops growing: it is already
 * far past the size the repo's file-size rules allow, and the group node shape
 * (service count + health badge) is self-contained enough to live on its own.
 *
 * The scan below is the same one that collects group names, so the per-service
 * instance statistics needed by the health badge cost no extra request.
 */
export const loadNacosServiceGroupsIntoTree = async ({
  node,
  options = {},
  nacosServiceGroupRequestIdsRef,
  loadingNodesRef,
  setLoadedKeys,
  replaceTreeNodeChildren,
  buildRpcConnectionConfig,
  getConnectionLoadEpoch,
  beginLoadGeneration,
  isCurrentConnectionLoadEpoch,
  isCurrentLoadGeneration,
  showError,
  listServices,
}: LoadNacosServiceGroupsArgs): Promise<boolean> => {
  const dataRef = node?.dataRef || {};
  const connectionId = String(dataRef.id || '');
  const namespaceId = String(dataRef.nacosNamespaceId ?? '');
  const namespaceName = String(dataRef.nacosNamespaceName || namespaceId || 'public');
  const nodeKeyId = namespaceId || 'public';
  const loadKey = `nacos-service-groups-${connectionId}-${nodeKeyId}`;
  if (!connectionId) return false;
  if (loadingNodesRef.current.has(loadKey) && !options.force) return false;
  const connectionEpoch = getConnectionLoadEpoch(connectionId);
  const loadGeneration = beginLoadGeneration(loadKey);
  const isCurrentLoad = () => (
    isCurrentConnectionLoadEpoch(connectionId, connectionEpoch)
    && isCurrentLoadGeneration(loadKey, loadGeneration)
  );
  const requestId = (nacosServiceGroupRequestIdsRef.current[loadKey] || 0) + 1;
  nacosServiceGroupRequestIdsRef.current[loadKey] = requestId;
  loadingNodesRef.current.add(loadKey);
  try {
    const rpcConfig = buildRpcConnectionConfig(dataRef.config || {});
    // Statistics ride along on the pages this scan already fetches, so asking for
    // them adds no request. When the server does not report them the scan marks
    // them unavailable and the badge stays hidden rather than inventing an
    // offline state.
    const scan = createNacosServiceScan();
    await walkNacosServicePages(async (pageNo, pageSize) => {
      const res = await listServices(rpcConfig, {
        namespaceId,
        groupName: '',
        pageNo,
        pageSize,
        withStatistics: true,
      });
      if (!res?.success) {
        // A backend message is already user-facing; the fallback must not leak a
        // hardcoded English string into the localized "connection failed" toast.
        throw new Error(res?.message || t('sidebar.nacos.service_groups_load_failed'));
      }
      return res.data || {};
    }, NACOS_SERVICE_GROUP_PAGE_SIZE, (page) => {
      foldNacosServiceScanPage(scan, page, parseNacosServiceName);
    });
    if (
      !isCurrentLoad()
      || nacosServiceGroupRequestIdsRef.current[loadKey] !== requestId
    ) {
      return false;
    }
    // The scan already collected every group name alongside its service count.
    const sortedGroups = sortNacosServiceGroups(scan.serviceCounts.keys());

    const allNode: any = {
      title: t('nacos_viewer.label.all'),
      key: `${connectionId}-nacos-ns-${nodeKeyId}-service-group-__all__`,
      icon: <AppstoreOutlined style={{ color: '#13C2C2' }} />,
      type: 'nacos-service-group',
      dataRef: {
        ...dataRef,
        nacosNamespaceId: namespaceId,
        nacosNamespaceName: namespaceName,
        nacosGroup: '',
        // The "all" row spans every group, so an aggregate here would mean summing
        // the whole namespace. It shows the service total only.
        nacosServiceCount: Array.from(scan.serviceCounts.values())
          .reduce((sum, count) => sum + count, 0),
      },
      isLeaf: true,
    };
    const groupNodes: any[] = sortedGroups.map((group) => ({
      title: group,
      key: `${connectionId}-nacos-ns-${nodeKeyId}-service-group-${encodeURIComponent(group)}`,
      icon: <FolderOpenOutlined style={{ color: '#13C2C2' }} />,
      type: 'nacos-service-group',
      dataRef: {
        ...dataRef,
        nacosNamespaceId: namespaceId,
        nacosNamespaceName: namespaceName,
        nacosGroup: group,
        nacosServiceCount: scan.serviceCounts.get(group) || 0,
        nacosGroupHealth: scan.groupHealth.get(group),
        nacosHealthAvailable: scan.statisticsAvailable,
      },
      isLeaf: true,
    }));
    replaceTreeNodeChildren(node.key, [allNode, ...groupNodes], dataRef);
    return true;
  } catch (error: any) {
    if (
      !isCurrentLoad()
      || nacosServiceGroupRequestIdsRef.current[loadKey] !== requestId
    ) {
      return false;
    }
    showError({
      content: t('sidebar.message.connection_failed', { error: error?.message || String(error) }),
      key: loadKey,
    });
    setLoadedKeys((prev) => prev.filter((k) => k !== node.key));
    return false;
  } finally {
    if (
      isCurrentLoad()
      && nacosServiceGroupRequestIdsRef.current[loadKey] === requestId
    ) {
      loadingNodesRef.current.delete(loadKey);
    }
  }
};
