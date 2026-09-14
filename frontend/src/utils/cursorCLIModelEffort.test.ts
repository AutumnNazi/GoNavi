import { describe, expect, it } from 'vitest';
import { applyCursorCLIModelEffort, parseCursorCLIModelID } from './cursorCLIModelEffort';

describe('cursor CLI model effort', () => {
  it('parses effort and fast suffixes independently', () => {
    expect(parseCursorCLIModelID('cursor-grok-4.6-xhigh-fast')).toEqual({
      family: 'cursor-grok-4.6', effort: 'xhigh', fast: true,
    });
    expect(parseCursorCLIModelID('claude-opus-5-thinking-high')).toEqual({
      family: 'claude-opus-5-thinking', effort: 'high', fast: false,
    });
    expect(parseCursorCLIModelID('composer-2.5-fast')).toEqual({
      family: 'composer-2.5', effort: '', fast: true,
    });
  });

  it('rewrites the model id instead of inventing an --effort flag', () => {
    expect(applyCursorCLIModelEffort('cursor-grok-4.6-xhigh', 'high')).toBe('cursor-grok-4.6-high');
    expect(applyCursorCLIModelEffort('cursor-grok-4.6-xhigh-fast', 'low')).toBe('cursor-grok-4.6-low-fast');
    expect(applyCursorCLIModelEffort('cursor-grok-4.6-xhigh', 'high', ['cursor-grok-4.6-xhigh'])).toBe('cursor-grok-4.6-xhigh');
    expect(applyCursorCLIModelEffort('cursor-grok-4.6-xhigh', '')).toBe('cursor-grok-4.6');
  });
});
