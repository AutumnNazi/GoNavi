import { afterEach, describe, expect, it, vi } from 'vitest';

import { compressContextIfNeeded, getDynamicMaxContextChars, sanitizeErrorMsg } from './aiChatRuntime';
import { setCurrentLanguage } from '../i18n';
import { useStore } from '../store';

describe('aiChatRuntime', () => {
  afterEach(() => {
    setCurrentLanguage('zh-CN');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('maps modern model families to practical context windows', () => {
    expect(getDynamicMaxContextChars('gemini-2.5-pro')).toBe(5000000);
    expect(getDynamicMaxContextChars('gpt-5')).toBe(1000000);
    expect(getDynamicMaxContextChars('claude-4-sonnet')).toBe(1000000);
    expect(getDynamicMaxContextChars('gpt-4o')).toBe(128000);
    expect(getDynamicMaxContextChars()).toBe(258000);
  });

  it('sanitizes html gateway errors and truncates oversized plain text errors', () => {
    expect(sanitizeErrorMsg('<html><head><title>502 Bad Gateway</title></head></html>')).toBe('HTTP 502: 502 Bad Gateway');
    expect(sanitizeErrorMsg('x'.repeat(320))).toBe(`${'x'.repeat(280)}...(已截断)`);
    expect(sanitizeErrorMsg('permission denied')).toBe('permission denied');
  });

  it('localizes runtime fallback errors while preserving raw details', () => {
    setCurrentLanguage('en-US');

    expect(sanitizeErrorMsg('')).toBe('Unknown error');
    expect(sanitizeErrorMsg('<html><body>HTTP 503</body></html>')).toBe('HTTP 503 server error');
    expect(sanitizeErrorMsg('<html><head><title>502 Bad Gateway</title></head></html>')).toBe('HTTP 502: 502 Bad Gateway');
    expect(sanitizeErrorMsg('<html><body>gateway timeout</body></html>')).toBe(
      'The server returned an abnormal HTML response, possibly a gateway timeout or unavailable service',
    );
    expect(sanitizeErrorMsg('x'.repeat(320))).toBe(`${'x'.repeat(280)}...(truncated)`);
    expect(sanitizeErrorMsg('permission denied')).toBe('permission denied');
  });

  it('skips compression when the payload is still within the configured limit', async () => {
    const result = await compressContextIfNeeded('session-1', [
      { role: 'user', content: 'short prompt' },
      { role: 'assistant', content: 'short answer' },
    ], 1000);

    expect(result).toBeNull();
  });

  it('settles and excludes the compression placeholder when the compression request throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sid = 'compression-error-session';
    useStore.setState((state) => ({
      aiChatHistory: { ...state.aiChatHistory, [sid]: [] },
    }));
    vi.stubGlobal('window', { go: {
      aiservice: {
        Service: {
          AIChatSend: vi.fn().mockRejectedValue(new Error('upstream disconnected')),
        },
      },
    } });

    const result = await compressContextIfNeeded(sid, [
      { role: 'user', content: 'x'.repeat(100) },
    ], 1);

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalledWith('Compression exception:', expect.any(Error));
    expect(useStore.getState().aiChatHistory[sid]).toEqual([
      expect.objectContaining({
        role: 'assistant',
        phase: 'idle',
        loading: false,
        excludeFromAIContext: true,
      }),
    ]);
  });
});
