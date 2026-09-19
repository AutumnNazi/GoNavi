import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildOriginalSqlSearchPattern,
  createAiSqlInsertHandler,
  findOriginalSqlMatch,
  type AiSqlInsertListenerOptions,
  tryReplaceOriginalSql,
} from './queryEditorAiSqlInsert';

vi.mock('antd', () => ({
  message: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../i18n', () => ({
  t: (key: string) => key,
}));

import { message } from 'antd';

const makeModel = (content: string) => ({
  getPositionAt: (offset: number) => {
    const clamped = Math.max(0, Math.min(offset, content.length));
    const before = content.slice(0, clamped).split('\n');
    return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
  },
  getLineCount: () => content.split('\n').length,
  getLineMaxColumn: (lineNumber: number) => (content.split('\n')[lineNumber - 1] || '').length + 1,
});

const applyRangeEdit = (content: string, range: any, text: string): string => {
  const lines = content.split('\n');
  const toOffset = (lineNumber: number, column: number) => {
    let offset = 0;
    for (let i = 0; i < lineNumber - 1; i += 1) offset += lines[i].length + 1;
    return offset + column - 1;
  };
  const start = toOffset(range.startLineNumber, range.startColumn);
  const end = toOffset(range.endLineNumber, range.endColumn);
  return content.slice(0, start) + text + content.slice(end);
};

const makeEditor = (content: string) => {
  let value = content;
  const edits: Array<{ source: string; range: any; text: string }> = [];
  const editor = {
    getValue: () => value,
    getModel: () => makeModel(value),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    executeEdits: (source: string, changes: Array<{ range: any; text: string }>) => {
      for (const change of changes) {
        edits.push({ source, range: change.range, text: change.text });
        value = applyRangeEdit(value, change.range, change.text);
      }
      return true;
    },
    pushUndoStop: vi.fn(),
    setSelection: vi.fn(),
    revealLineInCenterIfOutsideViewport: vi.fn(),
    setPosition: vi.fn(),
    focus: vi.fn(),
  };
  return { editor, edits };
};

const monaco = {
  Range: class {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    constructor(a: number, b: number, c: number, d: number) {
      this.startLineNumber = a;
      this.startColumn = b;
      this.endLineNumber = c;
      this.endColumn = d;
    }
  },
  Position: class {
    lineNumber: number;
    column: number;
    constructor(a: number, b: number) {
      this.lineNumber = a;
      this.column = b;
    }
  },
};

const makeOptions = (content: string) => {
  const { editor, edits } = makeEditor(content);
  const options: AiSqlInsertListenerOptions & { edits: typeof edits } = {
    tabId: 'tab-1',
    editorRef: { current: editor },
    monacoRef: { current: monaco },
    currentConnectionIdRef: { current: 'conn-1' },
    currentDbRef: { current: 'db-1' },
    switchQueryContext: vi.fn(() => true),
    applyQueryState: vi.fn(),
    getCurrentQuery: () => content,
    runAfterQueryContextReady: vi.fn(),
    edits,
  };
  return options;
};

describe('buildOriginalSqlSearchPattern', () => {
  it('escapes regex specials and collapses whitespace runs', () => {
    expect(buildOriginalSqlSearchPattern('SELECT a.b FROM t WHERE x = ')).toBe(
      'SELECT\\s+a\\.b\\s+FROM\\s+t\\s+WHERE\\s+x\\s+=\\s*;?',
    );
  });

  it('keeps the trailing semicolon optional', () => {
    expect(buildOriginalSqlSearchPattern('SELECT 1;')).toBe('SELECT\\s+1\\s*;?');
    expect(buildOriginalSqlSearchPattern('SELECT 1')).toBe('SELECT\\s+1\\s*;?');
  });

  it('returns empty for blank candidates', () => {
    expect(buildOriginalSqlSearchPattern('   ')).toBe('');
  });
});

describe('findOriginalSqlMatch', () => {
  it('matches across line breaks and indentation differences', () => {
    const content = 'BEGIN;\n  SELECT\n     1;\nCOMMIT;';
    expect(findOriginalSqlMatch(content, ['SELECT 1;'])).toEqual({
      start: content.indexOf('SELECT'),
      end: content.indexOf('1;') + 2,
    });
  });

  it('prefers candidates in order and returns the first hit', () => {
    const content = 'SELECT 1;';
    expect(findOriginalSqlMatch(content, ['SELECT missing', 'SELECT 1'])).toEqual({
      start: 0,
      end: 9,
    });
  });

  it('does not match when the candidate is absent', () => {
    expect(findOriginalSqlMatch('SELECT 2;', ['SELECT 1;'])).toBeNull();
    expect(findOriginalSqlMatch('', ['SELECT 1;'])).toBeNull();
  });
});

describe('tryReplaceOriginalSql', () => {
  it('performs one atomic edit between undo stops and applies the new state', () => {
    const content = 'SELECT broken;';
    const options = makeOptions(content);
    const applyQueryState = vi.fn();
    const ok = tryReplaceOriginalSql(
      options.editorRef.current!,
      monaco,
      options.editorRef.current!.getModel!(),
      ['SELECT broken;'],
      'SELECT fixed;',
      applyQueryState,
    );
    expect(ok).toBe(true);
    expect(options.edits).toHaveLength(1);
    expect(options.edits[0].source).toBe('ai-replace-original');
    expect(options.editorRef.current!.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(applyQueryState).toHaveBeenCalledWith('SELECT fixed;');
  });

  it('returns false without editing when nothing matches', () => {
    const options = makeOptions('SELECT other;');
    const ok = tryReplaceOriginalSql(
      options.editorRef.current!,
      monaco,
      options.editorRef.current!.getModel!(),
      ['SELECT broken;'],
      'SELECT fixed;',
      vi.fn(),
    );
    expect(ok).toBe(false);
    expect(options.edits).toHaveLength(0);
  });

  it('refuses to replace when the user has edited the original SQL and it no longer matches', () => {
    const content = 'SELECT id FROM t WHERE id = 5;';
    const options = makeOptions(content);
    const ok = tryReplaceOriginalSql(
      options.editorRef.current!,
      monaco,
      options.editorRef.current!.getModel!(),
      ['SELECT id FROM t WHERE id = ;'],
      'SELECT id FROM t WHERE id = 5 AND status = 1;',
      vi.fn(),
    );
    expect(ok).toBe(false);
    expect(options.edits).toHaveLength(0);
    expect(options.editorRef.current!.getValue!()).toBe(content);
  });
});

describe('createAiSqlInsertHandler', () => {
  beforeEach(() => {
    vi.mocked(message.success).mockClear();
    vi.mocked(message.warning).mockClear();
    vi.mocked(message.info).mockClear();
  });

  it('replaces the original statement and reports success when the candidate matches', () => {
    const options = makeOptions('SELECT broken;');
    createAiSqlInsertHandler(options)({
      detail: {
        tabId: 'tab-1',
        sql: 'SELECT fixed;',
        runImmediately: false,
        replaceOriginal: true,
        originalSqlCandidates: ['SELECT broken;'],
      },
    });
    expect(options.edits[0].source).toBe('ai-replace-original');
    expect(message.success).toHaveBeenCalledWith('query_editor.message.replace_original_success');
    expect(message.warning).not.toHaveBeenCalled();
    expect(options.applyQueryState).toHaveBeenCalledWith('SELECT fixed;');
  });

  it('makes no modification and warns when the replace candidate does not match', () => {
    const options = makeOptions('SELECT unrelated;');
    createAiSqlInsertHandler(options)({
      detail: {
        tabId: 'tab-1',
        sql: 'SELECT fixed;',
        runImmediately: false,
        replaceOriginal: true,
        originalSqlCandidates: ['SELECT broken;'],
      },
    });
    expect(options.edits).toHaveLength(0);
    expect(message.warning).toHaveBeenCalledWith('query_editor.message.replace_original_not_found');
    expect(message.success).not.toHaveBeenCalled();
  });

  it('keeps the plain insert behavior when the replace flag is absent', () => {
    const options = makeOptions('');
    createAiSqlInsertHandler(options)({
      detail: { tabId: 'tab-1', sql: 'SELECT fixed;', runImmediately: false },
    });
    expect(options.edits[0].source).toBe('ai-insert');
    expect(message.success).toHaveBeenCalledWith('query_editor.message.insert_success');
    expect(message.info).not.toHaveBeenCalled();
  });

  it('ignores events for other tabs', () => {
    const options = makeOptions('SELECT broken;');
    createAiSqlInsertHandler(options)({
      detail: {
        tabId: 'tab-other',
        sql: 'SELECT fixed;',
        runImmediately: false,
        replaceOriginal: true,
        originalSqlCandidates: ['SELECT broken;'],
      },
    });
    expect(options.edits).toHaveLength(0);
    expect(options.switchQueryContext).not.toHaveBeenCalled();
  });
});

describe('findOriginalSqlMatch trailing boundary', () => {
  it('does not consume the newline separating the next statement when the candidate has no semicolon', () => {
    const content = 'UPDATE t SET a = 1\nWHERE b = 2\nSELECT next;';
    const match = findOriginalSqlMatch(content, ['UPDATE t SET a = 1 WHERE b = 2']);
    expect(match).not.toBeNull();
    expect(content.slice(match!.start, match!.end)).toBe('UPDATE t SET a = 1\nWHERE b = 2');
  });

  it('keeps a semicolon that follows on its own line as part of the match', () => {
    const content = 'SELECT 1\n;\nSELECT 2;';
    const match = findOriginalSqlMatch(content, ['SELECT 1']);
    expect(match).not.toBeNull();
    expect(content.slice(match!.start, match!.end)).toBe('SELECT 1\n;');
  });
});

describe('findOriginalSqlMatch statement boundary guard', () => {
  it('rejects a candidate whose tail only prefix-matches an edited statement', () => {
    const content = 'SELECT * FROM users WHERE id = 5;';
    expect(findOriginalSqlMatch(content, ['SELECT * FROM users WHERE id = ;'])).toBeNull();
  });

  it('rejects prefix matches that would stop inside a longer token or list', () => {
    expect(findOriginalSqlMatch('SELECT 123;', ['SELECT 1'])).toBeNull();
    expect(findOriginalSqlMatch('SELECT 1, 2;', ['SELECT 1'])).toBeNull();
  });

  it('rejects a hit that does not start at a statement boundary', () => {
    expect(findOriginalSqlMatch('MSELECT 1;', ['SELECT 1'])).toBeNull();
  });

  it('skips a non-boundary hit and matches a later standalone occurrence', () => {
    const content = 'XSELECT 1; SELECT 1;';
    const match = findOriginalSqlMatch(content, ['SELECT 1']);
    expect(match).not.toBeNull();
    expect(content.slice(match!.start, match!.end)).toBe('SELECT 1;');
  });

  it('keeps matching a normal statement followed by the next one', () => {
    const content = 'SELECT 1;\nSELECT 2;';
    const match = findOriginalSqlMatch(content, ['SELECT 1']);
    expect(match).not.toBeNull();
    expect(content.slice(match!.start, match!.end)).toBe('SELECT 1;');
  });
});
