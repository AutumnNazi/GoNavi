import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '../../store';
import { injectQueryEditorAiPromptWithContext } from './queryEditorAiPromptInject';
import {
  resetDatabaseServerVersionCache,
  setDatabaseServerVersionQuery,
} from './queryEditorServerVersion';

describe('injectQueryEditorAiPromptWithContext', () => {
  afterEach(() => {
    resetDatabaseServerVersionCache();
    setDatabaseServerVersionQuery(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for the live server version and stuffs it into the injected prompt', async () => {
    setDatabaseServerVersionQuery(async () => ({
      success: true,
      message: 'PostgreSQL 12.1 (KingbaseES V8 R6)',
    }));
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const originalVisible = useStore.getState().aiPanelVisible;
    useStore.setState({ aiPanelVisible: true });

    await injectQueryEditorAiPromptWithContext({
      connection: {
        id: 'kb-1',
        name: 'kb-lab',
        config: { type: 'kingbase', host: '127.0.0.1' },
      },
      database: 'test',
      prompt: 'Generate a query.',
    });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<{ prompt: string }>;
    expect(event.type).toBe('gonavi:ai:inject-prompt');
    expect(event.detail.prompt).toContain('PostgreSQL 12.1 (KingbaseES V8 R6)');
    expect(event.detail.prompt).toContain('Generate a query.');

    useStore.setState({ aiPanelVisible: originalVisible });
  });
});
