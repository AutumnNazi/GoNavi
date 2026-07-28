import { describe, expect, it, vi } from 'vitest';

import { buildSidebarLegacyNodeMenuItems } from './sidebarLegacyNodeMenu';

describe('Nacos service group context menu', () => {
  it('opens the selected service group with its group filter', () => {
    const addTab = vi.fn();
    const items = buildSidebarLegacyNodeMenuItems({
      type: 'nacos-service-group',
      dataRef: {
        id: 'nacos-1',
        nacosNamespaceId: 'mkefu-dev',
        nacosNamespaceName: 'mkefu development',
        nacosGroup: 'MKEFU_SERVICE',
      },
    }, { addTab }) as any[];

    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe('open-nacos-service-group');
    items[0]?.onClick?.();
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      id: 'nacos-services-nacos-1-ns-mkefu-dev-g-MKEFU_SERVICE',
      type: 'nacos-services',
      nacosGroup: 'MKEFU_SERVICE',
    }));
  });

  it('does not attach a group filter to the all-services node', () => {
    const addTab = vi.fn();
    const items = buildSidebarLegacyNodeMenuItems({
      type: 'nacos-service-group',
      dataRef: {
        id: 'nacos-1',
        nacosNamespaceId: 'mkefu-dev',
        nacosNamespaceName: 'mkefu development',
        nacosGroup: '',
      },
    }, { addTab }) as any[];

    items[0]?.onClick?.();
    const tab = addTab.mock.calls[0]?.[0];
    expect(tab?.id).toBe('nacos-services-nacos-1-ns-mkefu-dev');
    expect(tab).not.toHaveProperty('nacosGroup');
  });
});
