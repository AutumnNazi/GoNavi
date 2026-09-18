import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '../../store';
import { diagnoseExecutionErrorWithAI, injectQueryEditorAiPromptWithContext } from './queryEditorAiPromptInject';
import {
  resetDatabaseServerVersionCache,
  setDatabaseServerVersionQuery,
} from './queryEditorServerVersion';

describe('diagnoseExecutionErrorWithAI', () => {
  const originalVisible = useStore.getState().aiPanelVisible;

  afterEach(() => {
    useStore.setState({ aiPanelVisible: originalVisible });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('dispatches the diagnosis prompt immediately when the AI panel is visible', () => {
    useStore.setState({ aiPanelVisible: true });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });

    diagnoseExecutionErrorWithAI('SELECT * FROM demo.t', "Table 'demo.t' doesn't exist");

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<{ prompt: string }>;
    expect(event.type).toBe('gonavi:ai:inject-prompt');
    expect(event.detail.prompt).toContain('SELECT * FROM demo.t');
    expect(event.detail.prompt).toContain("Table 'demo.t' doesn't exist");
  });

  it('opens the AI panel and delays the dispatch when it was closed', () => {
    useStore.setState({ aiPanelVisible: false });
    vi.useFakeTimers();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      dispatchEvent,
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    });

    diagnoseExecutionErrorWithAI('SELECT 1', 'boom');

    expect(useStore.getState().aiPanelVisible).toBe(true);
    expect(dispatchEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<{ prompt: string }>;
    expect(event.type).toBe('gonavi:ai:inject-prompt');
    expect(event.detail.prompt).toContain('SELECT 1');
    expect(event.detail.prompt).toContain('boom');
  });
});

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
