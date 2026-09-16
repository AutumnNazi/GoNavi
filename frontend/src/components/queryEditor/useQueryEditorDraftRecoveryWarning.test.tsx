import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const warning = vi.hoisted(() => vi.fn());

vi.mock('antd', () => ({ message: { warning } }));
vi.mock('../../i18n', () => ({
  t: (_key: string, params?: Record<string, unknown>) => `Recovery limited to ${params?.limit}`,
}));

import {
  clearQueryTabDraft,
  persistQueryTabDraftSnapshot,
} from '../../utils/sqlFileTabDrafts';
import { useQueryEditorDraftRecoveryWarning } from './useQueryEditorDraftRecoveryWarning';

const Probe = ({ tabId }: { tabId: string }) => {
  useQueryEditorDraftRecoveryWarning(tabId);
  return null;
};

describe('useQueryEditorDraftRecoveryWarning', () => {
  beforeEach(() => {
    warning.mockReset();
    clearQueryTabDraft('query-warning');
  });

  it('warns once when crash recovery keeps only a bounded prefix', async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe tabId="query-warning" />);
    });

    await act(async () => {
      persistQueryTabDraftSnapshot({
        id: 'query-warning',
        title: 'Large SQL',
        connectionId: 'conn-1',
        dbName: 'main',
      }, 'x'.repeat(2 * 1024 * 1024));
    });
    await act(async () => {
      persistQueryTabDraftSnapshot({
        id: 'query-warning',
        title: 'Large SQL',
        connectionId: 'conn-1',
        dbName: 'main',
      }, 'y'.repeat(3 * 1024 * 1024));
    });

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('Recovery limited to 1 MiB');
    renderer.unmount();
  });
});
