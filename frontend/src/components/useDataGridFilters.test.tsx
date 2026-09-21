import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useDataGridFilters, type UseDataGridFiltersResult } from './useDataGridFilters';

const createFilterHookProps = (
  overrides: Partial<Parameters<typeof useDataGridFilters>[0]> = {},
): Parameters<typeof useDataGridFilters>[0] => ({
  appliedFilterConditions: [],
  quickWhereCondition: '',
  showFilter: false,
  displayColumnNames: ['id', 'code', 'title'],
  allTableColumnNames: ['id', 'code', 'title'],
  columnMetaMap: {
    id: { type: 'bigint' },
    code: { type: 'varchar(50)' },
    title: { type: 'varchar(500)' },
  },
  dbType: 'mysql',
  darkMode: false,
  getColumnFilterType: (columnName) => {
    if (columnName === 'id') return 'bigint';
    return 'varchar(255)';
  },
  resolveDefaultGridFilterOperator: (columnType) => (
    String(columnType || '').toLowerCase().includes('char') ? 'CONTAINS' : '='
  ),
  resolveNextGridFilterOperatorForColumnChange: () => 'CONTAINS',
  ...overrides,
});

describe('useDataGridFilters', () => {
  it('renders initial filters once and still synchronizes replacement filters', () => {
    const props = createFilterHookProps();
    const snapshots: UseDataGridFiltersResult[] = [];
    const Harness = ({ filters }: { filters: typeof props.appliedFilterConditions }) => {
      snapshots.push(useDataGridFilters({ ...props, appliedFilterConditions: filters }));
      return null;
    };
    let tree: ReactTestRenderer;
    const initial = [{ id: 7, column: 'code', op: '=', value: 'A' }];
    act(() => { tree = create(<Harness filters={initial} />); });
    try {
      expect(snapshots[0].filterConditions).toMatchObject(initial);
      expect(snapshots).toHaveLength(1);
      act(() => tree.update(<Harness filters={[]} />));
      expect(snapshots[snapshots.length - 1].filterConditions).toEqual([]);
      act(() => { snapshots[snapshots.length - 1].applyColumnFilter({ column: 'title', op: '=', value: 'B' }); });
      expect(snapshots[snapshots.length - 1].filterConditions).toMatchObject([{ column: 'title', value: 'B' }]);
    } finally { act(() => tree.unmount()); }
  });
  it('syncs column-header filters into the shared toolbar filter state without requiring the filter panel to be open', () => {
    const onApplyFilter = vi.fn();
    const hookProps = createFilterHookProps({
      showFilter: false,
      onApplyFilter,
    });
    let latest: UseDataGridFiltersResult | undefined;
    let renderer: ReactTestRenderer | undefined;

    const Harness = () => {
      latest = useDataGridFilters(hookProps);
      return null;
    };

    act(() => {
      renderer = create(<Harness />);
    });

    expect(latest?.filterConditions).toEqual([]);

    act(() => {
      expect(latest?.applyColumnFilter({
        column: 'code',
        op: 'CONTAINS',
        value: '3551',
      })).toBe(true);
    });

    expect(latest?.filterConditions).toMatchObject([{
      enabled: true,
      logic: 'AND',
      column: 'code',
      op: 'CONTAINS',
      value: '3551',
      value2: '',
    }]);
    expect(onApplyFilter).toHaveBeenCalledWith([
      expect.objectContaining({
        enabled: true,
        logic: 'AND',
        column: 'code',
        op: 'CONTAINS',
        value: '3551',
        value2: '',
      }),
    ]);

    renderer?.unmount();
  });

  it('preserves earlier value selections when a second column filter is applied', () => {
    let latest: UseDataGridFiltersResult | undefined;
    let renderer: ReactTestRenderer | undefined;

    const Harness = () => {
      const [appliedConditions, setAppliedConditions] = React.useState<Parameters<typeof useDataGridFilters>[0]['appliedFilterConditions']>([]);
      latest = useDataGridFilters(createFilterHookProps({
        appliedFilterConditions: appliedConditions,
        onApplyFilter: setAppliedConditions,
      }));
      return null;
    };

    act(() => {
      renderer = create(<Harness />);
    });

    act(() => {
      latest?.applyColumnFilter({
        column: 'code',
        op: 'IN',
        valueSelection: { values: ['A'] },
      });
    });
    act(() => {
      latest?.applyColumnFilter({
        column: 'title',
        op: 'IN',
        valueSelection: { values: ['B'] },
      });
    });

    expect(latest?.filterConditions).toEqual([
      expect.objectContaining({
        column: 'code',
        op: 'IN',
        valueSelection: { values: ['A'] },
      }),
      expect.objectContaining({
        column: 'title',
        op: 'IN',
        valueSelection: { values: ['B'] },
      }),
    ]);

    renderer?.unmount();
  });
});

// Issue #1302: enable/disable-all used to stay a local draft until "apply" was pressed,
// so the toolbar looked as if the click had done nothing.
describe('useDataGridFilters enable/disable all (issue #1302)', () => {
  const renderWithApplied = (
    appliedConditions: Parameters<typeof useDataGridFilters>[0]['appliedFilterConditions'],
    onApplyFilter: (conditions: any[]) => void,
  ) => {
    let latest: UseDataGridFiltersResult | undefined;
    let renderer: ReactTestRenderer | undefined;
    const hookProps = createFilterHookProps({ appliedFilterConditions: appliedConditions, onApplyFilter });

    const Harness = () => {
      latest = useDataGridFilters(hookProps);
      return null;
    };

    act(() => {
      renderer = create(<Harness />);
    });

    return { getLatest: () => latest, unmount: () => renderer?.unmount() };
  };

  const appliedPair = [
    { id: 1, enabled: true, column: 'code', op: '=', value: '3551' },
    { id: 2, enabled: true, column: 'title', op: 'CONTAINS', value: 'navi' },
  ];

  it('pushes every condition as disabled on the first click', () => {
    const onApplyFilter = vi.fn();
    const { getLatest, unmount } = renderWithApplied(appliedPair, onApplyFilter);

    act(() => {
      getLatest()?.applyAllFiltersDisabled();
    });

    expect(onApplyFilter).toHaveBeenCalledOnce();
    expect(onApplyFilter.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 1, enabled: false }),
      expect.objectContaining({ id: 2, enabled: false }),
    ]);
    expect(getLatest()?.filterConditions.every((cond) => cond.enabled === false)).toBe(true);

    unmount();
  });

  it('pushes every condition as enabled on the first click', () => {
    const onApplyFilter = vi.fn();
    const { getLatest, unmount } = renderWithApplied(
      appliedPair.map((cond) => ({ ...cond, enabled: false })),
      onApplyFilter,
    );

    act(() => {
      getLatest()?.applyAllFiltersEnabled();
    });

    expect(onApplyFilter).toHaveBeenCalledOnce();
    expect(onApplyFilter.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 1, enabled: true }),
      expect.objectContaining({ id: 2, enabled: true }),
    ]);

    unmount();
  });

  it('is a no-op when the requested flag already matches every condition', () => {
    const onApplyFilter = vi.fn();
    const { getLatest, unmount } = renderWithApplied(appliedPair, onApplyFilter);

    act(() => {
      getLatest()?.applyAllFiltersEnabled();
      getLatest()?.applyAllFiltersEnabled();
    });

    expect(onApplyFilter).not.toHaveBeenCalled();

    unmount();
  });

  it('does not refetch when there is nothing to enable or disable', () => {
    const onApplyFilter = vi.fn();
    const { getLatest, unmount } = renderWithApplied([], onApplyFilter);

    act(() => {
      getLatest()?.applyAllFiltersDisabled();
      getLatest()?.applyAllFiltersEnabled();
    });

    expect(onApplyFilter).not.toHaveBeenCalled();

    unmount();
  });

  it('keeps only the leading condition enabled when the rest are mixed', () => {
    const onApplyFilter = vi.fn();
    const { getLatest, unmount } = renderWithApplied(appliedPair, onApplyFilter);

    act(() => {
      getLatest()?.applyAllFiltersDisabled();
    });
    act(() => {
      getLatest()?.applyAllFiltersEnabled();
    });

    expect(onApplyFilter).toHaveBeenCalledTimes(2);
    expect(onApplyFilter.mock.calls[1][0].every((cond: any) => cond.enabled === true)).toBe(true);

    unmount();
  });

  it('does not throw when the host omits onApplyFilter', () => {
    let latest: UseDataGridFiltersResult | undefined;
    let renderer: ReactTestRenderer | undefined;
    const hookProps = createFilterHookProps({ appliedFilterConditions: appliedPair });

    const Harness = () => {
      latest = useDataGridFilters(hookProps);
      return null;
    };

    act(() => {
      renderer = create(<Harness />);
    });

    expect(() => {
      act(() => {
        latest?.applyAllFiltersDisabled();
      });
    }).not.toThrow();
    expect(latest?.filterConditions.every((cond) => cond.enabled === false)).toBe(true);

    renderer?.unmount();
  });
});
