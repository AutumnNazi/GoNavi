import React, { useEffect, useMemo } from 'react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';

import { t } from '../../i18n';
import { useStore } from '../../store';
import { createWorkbenchTabsSelector } from '../../utils/workbenchTabsSelector';
import { renderV2ActionMenuPopup } from '../common/V2ActionMenuPopup';
import {
  acknowledgeQueryEditorTabExecution,
  useQueryEditorTabExecutionDockEntries,
  useQueryEditorTabExecutionOpenTabPrune,
  type QueryEditorTabExecutionDockAppearance,
  type QueryEditorTabExecutionDockEntry,
} from './queryEditorTabExecutionState';

export type QueryEditorRunningDockItem = {
  id: string;
  title: string;
  appearance: QueryEditorTabExecutionDockAppearance;
};

const dockCopyByAppearance: Record<QueryEditorTabExecutionDockAppearance, {
  status: string;
  statusCount: string;
  open: string;
  openCount: string;
}> = {
  running: {
    status: 'query_editor.execution.tab_running',
    statusCount: 'query_editor.execution.tab_running_count',
    open: 'query_editor.execution.tab_running_open',
    openCount: 'query_editor.execution.tab_running_open_count',
  },
  done: {
    status: 'query_editor.execution.tab_done',
    statusCount: 'query_editor.execution.tab_done_count',
    open: 'query_editor.execution.tab_done_open',
    openCount: 'query_editor.execution.tab_done_open_count',
  },
  error: {
    status: 'query_editor.execution.tab_error',
    statusCount: 'query_editor.execution.tab_error_count',
    open: 'query_editor.execution.tab_error_open',
    openCount: 'query_editor.execution.tab_error_open_count',
  },
};

export const buildQueryEditorRunningDockItems = (
  entries: readonly QueryEditorTabExecutionDockEntry[],
  activeTabId: string | null | undefined,
  tabs: ReadonlyArray<{ id: string; title?: string }>,
): QueryEditorRunningDockItem[] => {
  const activeId = String(activeTabId || '').trim();
  const titleById = new Map(
    tabs.map((tab) => [String(tab.id || '').trim(), String(tab.title || '').trim()] as const),
  );
  const items: QueryEditorRunningDockItem[] = [];
  const seen = new Set<string>();
  entries.forEach((entry) => {
    const id = String(entry.tabId || '').trim();
    if (!id || id === activeId || seen.has(id) || !titleById.has(id)) return;
    seen.add(id);
    items.push({
      id,
      title: titleById.get(id) || '',
      appearance: entry.appearance,
    });
  });
  return items;
};

export const shouldUseQueryEditorRunningDockMenu = (itemCount: number): boolean => itemCount > 1;

export const resolveQueryEditorRunningDockChipAppearance = (
  items: ReadonlyArray<{ appearance: QueryEditorTabExecutionDockAppearance }>,
): QueryEditorTabExecutionDockAppearance => {
  if (items.some((item) => item.appearance === 'running')) return 'running';
  if (items.some((item) => item.appearance === 'error')) return 'error';
  return 'done';
};

const openQueryEditorDockTab = (tabId: string, setActiveTab: (id: string) => void) => {
  acknowledgeQueryEditorTabExecution(tabId);
  setActiveTab(tabId);
};

type RunningDockChipProps = {
  appearance: QueryEditorTabExecutionDockAppearance;
  label: string;
  statusText: string;
  title?: string;
  showCaret?: boolean;
  onClick?: () => void;
};

const RunningDockChip = React.forwardRef<HTMLButtonElement, RunningDockChipProps>(({
  appearance,
  label,
  statusText,
  title,
  showCaret = false,
  onClick,
}, ref) => (
  <button
    ref={ref}
    type="button"
    className="gn-v2-query-running-chip"
    data-status={appearance}
    title={label}
    aria-label={label}
    onClick={onClick}
  >
    <span className="gn-v2-tab-running-dot" aria-hidden="true" />
    <span className="gn-v2-query-running-chip-status">{statusText}</span>
    {title ? <span className="gn-v2-query-running-chip-title">{title}</span> : null}
    {showCaret ? <span className="gn-v2-query-running-chip-caret" aria-hidden="true" /> : null}
  </button>
));

const QueryEditorRunningTabsDockComponent: React.FC = () => {
  const dockEntries = useQueryEditorTabExecutionDockEntries();
  const tabsSelector = useMemo(createWorkbenchTabsSelector, []);
  const tabs = useStore(tabsSelector);
  const activeTabId = useStore((state) => state.activeTabId);
  const setActiveTab = useStore((state) => state.setActiveTab);
  useQueryEditorTabExecutionOpenTabPrune(tabs);
  useEffect(() => {
    const id = String(activeTabId || '').trim();
    if (id) acknowledgeQueryEditorTabExecution(id);
  }, [activeTabId]);
  const items = buildQueryEditorRunningDockItems(dockEntries, activeTabId, tabs);
  if (items.length === 0) return null;

  const chipAppearance = resolveQueryEditorRunningDockChipAppearance(items);
  const copy = dockCopyByAppearance[chipAppearance];
  if (!shouldUseQueryEditorRunningDockMenu(items.length)) {
    const item = items[0];
    const itemCopy = dockCopyByAppearance[item.appearance];
    const label = item.title
      ? t(itemCopy.open, { title: item.title })
      : t(itemCopy.status);
    return (
      <div className="gn-v2-query-running-dock" data-testid="query-editor-running-dock">
        <RunningDockChip
          appearance={item.appearance}
          label={label}
          statusText={t(itemCopy.status)}
          title={item.title}
          onClick={() => openQueryEditorDockTab(item.id, setActiveTab)}
        />
      </div>
    );
  }

  const menuItems: MenuProps['items'] = items.map((item) => ({
    key: item.id,
    icon: (
      <span
        className="gn-v2-query-running-menu-dot"
        data-status={item.appearance}
        aria-hidden="true"
      />
    ),
    label: (
      <span className="gn-v2-query-running-menu-title">
        {item.title || t(dockCopyByAppearance[item.appearance].status)}
      </span>
    ),
    onClick: () => openQueryEditorDockTab(item.id, setActiveTab),
  }));
  const countLabel = t(copy.statusCount, { count: items.length });

  return (
    <div className="gn-v2-query-running-dock" data-testid="query-editor-running-dock">
      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        rootClassName="gn-v2-tab-context-menu-popup gn-v2-query-running-dock-popup"
        popupRender={(menu) => renderV2ActionMenuPopup(menu, true, {
          title: countLabel,
          showHeader: false,
        })}
      >
        <RunningDockChip
          appearance={chipAppearance}
          label={t(copy.openCount, { count: items.length })}
          statusText={countLabel}
          showCaret
        />
      </Dropdown>
    </div>
  );
};

export const QueryEditorRunningTabsDock = React.memo(QueryEditorRunningTabsDockComponent);
