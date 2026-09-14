import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveSidebarDoubleClickExpandedKeys } from './sidebarHelpers';

const sidebarSource = readFileSync(new URL('../Sidebar.tsx', import.meta.url), 'utf8');

describe('resolveSidebarDoubleClickExpandedKeys', () => {
  it('keeps an already expanded connection open instead of collapsing it', () => {
    expect(resolveSidebarDoubleClickExpandedKeys({
      nodeType: 'connection',
      nodeKey: 'kingbase-1',
      expandedKeys: ['tag-a', 'kingbase-1'],
    })).toEqual({
      expandedKeys: ['tag-a', 'kingbase-1'],
      didExpand: false,
    });
  });

  it('expands a collapsed connection so workbench locate and tree double-click agree', () => {
    expect(resolveSidebarDoubleClickExpandedKeys({
      nodeType: 'connection',
      nodeKey: 'kingbase-1',
      expandedKeys: ['tag-a'],
    })).toEqual({
      expandedKeys: ['tag-a', 'kingbase-1'],
      didExpand: true,
    });
  });

  it('still toggles non-connection directories on double-click', () => {
    expect(resolveSidebarDoubleClickExpandedKeys({
      nodeType: 'database',
      nodeKey: 'kingbase-1-app',
      expandedKeys: ['kingbase-1', 'kingbase-1-app'],
    })).toEqual({
      expandedKeys: ['kingbase-1'],
      didExpand: false,
    });
    expect(resolveSidebarDoubleClickExpandedKeys({
      nodeType: 'database',
      nodeKey: 'kingbase-1-app',
      expandedKeys: ['kingbase-1'],
    })).toEqual({
      expandedKeys: ['kingbase-1', 'kingbase-1-app'],
      didExpand: true,
    });
  });

  it('wires connection double-click through the expand-only helper', () => {
    expect(sidebarSource).toContain('resolveSidebarDoubleClickExpandedKeys');
    expect(sidebarSource).not.toMatch(/expandedKeys\.filter\(\s*k => k !== key\s*\)/);
  });
});
