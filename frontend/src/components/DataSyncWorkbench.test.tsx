import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { TabData } from '../types';
import DataSyncWorkbench from './DataSyncWorkbench';

const closeTab = vi.fn();

vi.mock('../store', () => ({
  useStore: (selector: (state: { closeTab: typeof closeTab }) => unknown) =>
    selector({ closeTab }),
}));

vi.mock('./DataSyncModal', () => ({
  default: ({ embedded, entryMode, taskKey, onClose }: {
    embedded?: boolean;
    entryMode?: string;
    taskKey?: string;
    onClose: () => void;
  }) => (
    <button
      type="button"
      data-data-sync-modal="true"
      data-embedded={embedded ? 'true' : 'false'}
      data-entry-mode={entryMode}
      data-task-key={taskKey}
      onClick={onClose}
    />
  ),
}));

const tab: TabData = {
  id: 'data-sync-workbench-schema-compare',
  title: '表结构比对',
  type: 'data-sync',
  connectionId: '',
  dataSyncEntryMode: 'schemaCompare',
};

describe('DataSyncWorkbench', () => {
  it('renders the selected workflow as an embedded workbench and closes its tab', () => {
    closeTab.mockReset();

    const markup = renderToStaticMarkup(<DataSyncWorkbench tab={tab} />);
    expect(markup).toContain('data-data-sync-workbench="true"');
    expect(markup).toContain('data-embedded="true"');
    expect(markup).toContain('data-entry-mode="schemaCompare"');
    expect(markup).toContain('data-task-key="data-sync-workbench-schema-compare"');

    const renderer = TestRenderer.create(<DataSyncWorkbench tab={tab} />);
    act(() => {
      renderer.root.findByProps({ 'data-data-sync-modal': 'true' }).props.onClick();
    });

    expect(closeTab).toHaveBeenCalledWith(tab.id);
  });
});
