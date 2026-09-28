/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { SavedConnection, TabData } from '../../types';
import { useSidebarWorkbenchLaunchers, type SidebarWorkbenchLaunchers } from './useSidebarWorkbenchLaunchers';

const mysql = { id: 'm1', name: 'mysql', config: { type: 'mysql', host: 'h', port: 3306, user: 'root' } } as unknown as SavedConnection;
const sqlite = { id: 's1', name: 'sqlite', config: { type: 'sqlite', host: '', port: 0, user: '' } } as unknown as SavedConnection;

const renderLaunchers = (activeConnection: SavedConnection | null, addTab: (tab: TabData) => void) => {
  let captured: SidebarWorkbenchLaunchers | null = null;
  const Probe = () => {
    captured = useSidebarWorkbenchLaunchers({ activeTab: null, activeTabHasConnection: false, activeConnection, addTab });
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return captured as unknown as SidebarWorkbenchLaunchers;
};

describe('useSidebarWorkbenchLaunchers user management action', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  it('opens the active connection user management tab when supported', () => {
    const addTab = vi.fn();
    const launchers = renderLaunchers(mysql, addTab);
    expect(launchers.userManagementAction.key).toBe('user-management');
    launchers.userManagementAction.onClick?.();
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-management:m1', connectionId: 'm1' }));
  });

  it('falls back to the connection picker for unsupported or missing connections', () => {
    for (const connection of [sqlite, null]) {
      const addTab = vi.fn();
      renderLaunchers(connection, addTab).userManagementAction.onClick?.();
      expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-management:picker', connectionId: '' }));
    }
  });
});
