import { describe, expect, it } from 'vitest';

import {
  buildNacosServicesTabData,
  resolveNacosServicesDoubleClickAction,
  shouldLoadSidebarNodeOnExpand as shouldLoadV2SidebarNodeOnExpand,
} from './sidebarV2Utils';
import { shouldLoadSidebarNodeOnExpand } from './sidebar/sidebarHelpers';

const namespaceData = {
  id: 'nacos-1',
  nacosNamespaceId: 'mkefu-dev',
  nacosNamespaceName: 'mkefu development',
};

describe('Nacos service group navigation', () => {
  it('keeps the service explorer entry as a lazy folder on double click', () => {
    const entryNode = {
      type: 'nacos-services-entry' as const,
      children: [],
      isLeaf: false,
    };
    expect(shouldLoadV2SidebarNodeOnExpand(entryNode)).toBe(true);
    expect(shouldLoadSidebarNodeOnExpand(entryNode)).toBe(true);
    expect(resolveNacosServicesDoubleClickAction({
      type: 'nacos-services-entry',
      dataRef: namespaceData,
    })).toEqual({ kind: 'expand' });
  });

  it('opens the all-services tab without a group filter', () => {
    const tab = buildNacosServicesTabData({
      ...namespaceData,
      nacosGroup: '',
    });

    expect(tab).toMatchObject({
      id: 'nacos-services-nacos-1-ns-mkefu-dev',
      type: 'nacos-services',
      connectionId: 'nacos-1',
      nacosNamespaceId: 'mkefu-dev',
      nacosNamespaceName: 'mkefu development',
    });
    expect(tab).not.toHaveProperty('nacosGroup');
  });

  it('opens a group-specific tab with an isolated id and filter', () => {
    const action = resolveNacosServicesDoubleClickAction({
      type: 'nacos-service-group',
      dataRef: {
        ...namespaceData,
        nacosGroup: 'MKEFU SERVICE',
      },
    });

    expect(action).toEqual({
      kind: 'open',
      tab: expect.objectContaining({
        id: 'nacos-services-nacos-1-ns-mkefu-dev-g-MKEFU%20SERVICE',
        title: 'mkefu development · MKEFU SERVICE',
        type: 'nacos-services',
        nacosGroup: 'MKEFU SERVICE',
      }),
    });
  });
});
