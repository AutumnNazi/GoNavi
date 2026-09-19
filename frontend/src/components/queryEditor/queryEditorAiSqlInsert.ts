import { useEffect, useRef } from 'react';
import { message } from 'antd';

import { t as translate } from '../../i18n';

export const AI_SQL_INSERT_TO_TAB_EVENT = 'gonavi:insert-sql-to-tab';

export interface AiSqlInsertEventDetail {
  tabId?: string;
  sql?: string;
  runImmediately?: boolean;
  connectionId?: string;
  dbName?: string;
  /** “替换原 SQL”按钮带上；为 true 且非 runImmediately 时整段替换命中的原 SQL，未命中不修改。 */
  replaceOriginal?: boolean;
  /** 会话中该 AI 回复对应的出错 SQL 候选（按消息顺序，首个优先）。 */
  originalSqlCandidates?: string[];
}

export interface AiSqlInsertMonacoPosition {
  lineNumber: number;
  column: number;
}

export interface AiSqlInsertMonacoModel {
  getPositionAt: (offset: number) => AiSqlInsertMonacoPosition;
  getLineCount: () => number;
  getLineMaxColumn: (lineNumber: number) => number;
}

export interface AiSqlInsertEditor {
  getValue?: () => string;
  getModel?: () => AiSqlInsertMonacoModel | null;
  getPosition?: () => AiSqlInsertMonacoPosition | null;
  executeEdits: (
    source: string,
    edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>,
  ) => unknown;
  pushUndoStop?: () => void;
  setSelection: (range: unknown) => void;
  revealLineInCenterIfOutsideViewport?: (lineNumber: number) => void;
  setPosition: (position: AiSqlInsertMonacoPosition) => void;
  focus?: () => void;
}

export interface AiSqlInsertMonaco {
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) => unknown;
  Position: new (lineNumber: number, column: number) => AiSqlInsertMonacoPosition;
}

export interface AiSqlInsertListenerOptions {
  tabId: string;
  editorRef: { current: AiSqlInsertEditor | null };
  monacoRef: { current: AiSqlInsertMonaco | null };
  currentConnectionIdRef: { current: string };
  currentDbRef: { current: string };
  switchQueryContext: (nextConnectionId: string, nextDbName: string) => boolean;
  applyQueryState: (nextQuery: string) => void;
  getCurrentQuery: () => string;
  runAfterQueryContextReady: () => void;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把候选 SQL 转成用于精确匹配的正则：忽略空白差异（缩进/换行），
 * 结尾分号可有可无，保证“从编辑器里复制的 SQL”在轻度编辑后仍能命中。
 */
export const buildOriginalSqlSearchPattern = (candidate: string): string => {
  const core = String(candidate || '').trim();
  if (!core) return '';
  const withoutTrailingSemicolon = core.endsWith(';') ? core.slice(0, -1) : core;
  const pattern = escapeRegExp(withoutTrailingSemicolon.trim()).replace(/\s+/g, '\\s+');
  if (!pattern) return '';
  return `${pattern}\\s*;?`;
};

export interface OriginalSqlMatch {
  start: number;
  end: number;
}

const isStatementStartBoundary = (source: string, index: number): boolean =>
  index <= 0 || source[index - 1] === ';' || /\s/.test(source[index - 1]);

/**
 * 语句终点只允许三种形态：分号终结、文末、换行分隔的下一条语句。
 * 行内空白后直接跟实质内容说明编辑器里的语句比候选长（用户补过值等），
 * 此时不允许命中，否则替换后会残留后半段内容（如候选 `WHERE id =` 命中 `WHERE id = 5;`）。
 */
const endsAtStatementBoundary = (source: string, index: number): boolean => {
  let cursor = index;
  let sawNewline = false;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    const ch = source[cursor];
    if (ch === '\n' || ch === '\r') sawNewline = true;
    cursor += 1;
  }
  if (cursor >= source.length) return true;
  if (source[cursor] === ';') return true;
  return sawNewline;
};

/**
 * 在编辑器全文中按候选顺序查找“原 SQL”，返回首个命中的字符区间。
 * 只做纯文本匹配，不依赖 Monaco 实例，便于单测。
 * 命中必须落在语句边界上：起点前是文首/分号/空白，终点后只跟分号、文末或换行，
 * 排除前缀误匹配（候选命中更长语句的中段会静默损坏编辑器内容）；
 * 单个候选跳过非边界命中继续找下一个位置。
 * 命中若不以分号结尾，收回尾随空白（\s* 可能吞掉语句间换行，导致替换后下一条语句被粘行）。
 */
export const findOriginalSqlMatch = (
  content: string,
  candidates: string[],
): OriginalSqlMatch | null => {
  const source = String(content || '');
  if (!source || !candidates?.length) return null;
  for (const candidate of candidates) {
    const pattern = buildOriginalSqlSearchPattern(candidate);
    if (!pattern) continue;
    const regex = new RegExp(pattern, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      if (!isStatementStartBoundary(source, match.index)) continue;
      const matched = match[0];
      const end = matched.endsWith(';')
        ? match.index + matched.length
        : match.index + matched.replace(/\s+$/, '').length;
      if (end <= match.index) return null;
      // 在语句本体结束处（收回 \s* 吞掉的尾随空白与可选分号之后）校验终点边界；
      // 从 end 继续向后扫描，被吞掉的空白会被重新检查，不会漏掉残留内容。
      if (!endsAtStatementBoundary(source, end)) continue;
      return { start: match.index, end };
    }
  }
  return null;
};

/**
 * 用单次原子编辑把命中的原 SQL 整段替换为 AI 给出的 SQL。
 * pushUndoStop 前后包裹，保证一次 Ctrl+Z 即可恢复整篇原文。
 * 未命中（或编辑器为空）时返回 false，由调用方回退为普通插入。
 */
export const tryReplaceOriginalSql = (
  editor: AiSqlInsertEditor,
  monaco: AiSqlInsertMonaco,
  model: AiSqlInsertMonacoModel | null | undefined,
  candidates: string[],
  nextSql: string,
  applyQueryState: (nextQuery: string) => void,
): boolean => {
  if (!model || !candidates?.length || !nextSql) return false;
  const content = String(editor.getValue?.() || '');
  const match = findOriginalSqlMatch(content, candidates);
  if (!match) return false;

  const startPosition = model.getPositionAt(match.start);
  const endPosition = model.getPositionAt(match.end);

  editor.focus?.();
  editor.pushUndoStop?.();
  editor.executeEdits('ai-replace-original', [{
    range: new monaco.Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column),
    text: nextSql,
    forceMoveMarkers: true,
  }]);
  editor.pushUndoStop?.();
  const nextValue = editor.getValue?.();
  if (typeof nextValue === 'string') {
    applyQueryState(nextValue);
  }
  editor.revealLineInCenterIfOutsideViewport?.(startPosition.lineNumber);
  editor.focus?.();
  return true;
};

export const createAiSqlInsertHandler = (options: AiSqlInsertListenerOptions) =>
(event: { detail?: AiSqlInsertEventDetail }): void => {
  const detail = event.detail || {};
  if (detail.tabId !== options.tabId || !detail.sql) return;
  const { sql: sqlText } = detail;

  const activeConnectionId = String(options.currentConnectionIdRef.current || '').trim();
  const targetConnectionId = String(detail.connectionId || activeConnectionId).trim();
  const targetDbName = String(
    detail.dbName ?? (targetConnectionId === activeConnectionId ? options.currentDbRef.current : ''),
  ).trim();
  if (!options.switchQueryContext(targetConnectionId, targetDbName)) return;

  const editor = options.editorRef.current;
  const monaco = options.monacoRef.current;
  if (editor && monaco) {
    const model = editor.getModel?.() ?? null;
    const existingContent = editor.getValue?.() || '';

    // runImmediately 模式下，如果编辑器内容已是待注入的 SQL（TabManager 创建时已传入），
    // 跳过追加，直接选中全部内容并执行
    if (detail.runImmediately && existingContent.trim() === sqlText.trim()) {
      if (model) {
        const lineCount = model.getLineCount();
        const maxCol = model.getLineMaxColumn(lineCount);
        editor.setSelection(new monaco.Range(1, 1, lineCount, maxCol));
        editor.focus?.();
        options.runAfterQueryContextReady();
      }
      return;
    }

    // 显式“替换原 SQL”按钮：整段替换命中的原 SQL；未命中时提示且不做任何修改
    if (detail.replaceOriginal && !detail.runImmediately) {
      const candidates = Array.isArray(detail.originalSqlCandidates) ? detail.originalSqlCandidates : [];
      if (tryReplaceOriginalSql(editor, monaco, model, candidates, sqlText, options.applyQueryState)) {
        message.success(translate('query_editor.message.replace_original_success'));
        return;
      }
      message.warning(translate('query_editor.message.replace_original_not_found'));
      return;
    }

    let position = editor.getPosition?.();
    if (!position && model) {
      const lineCount = model.getLineCount();
      const maxCol = model.getLineMaxColumn(lineCount);
      position = new monaco.Position(lineCount, maxCol);
    }

    if (position) {
      const mText = (sqlText.endsWith('\n') ? sqlText : sqlText + '\n');
      const startRange = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);

      editor.executeEdits('ai-insert', [{
        range: startRange,
        text: (position.column > 1 ? '\n' : '') + mText,
        forceMoveMarkers: true,
      }]);
      const nextValue = editor.getValue?.();
      if (typeof nextValue === 'string') {
        options.applyQueryState(nextValue);
      }

      // 定位并滚动到可见区域
      const targetLine = position.lineNumber + (position.column > 1 ? 1 : 0);
      editor.revealLineInCenterIfOutsideViewport?.(targetLine);
      editor.setPosition({ lineNumber: targetLine + mText.split('\n').length - 1, column: 1 });
      editor.focus?.();

      if (!detail.runImmediately) {
        message.success(translate('query_editor.message.insert_success'));
      }

      if (detail.runImmediately) {
        const endPosition = editor.getPosition?.() ?? null;
        editor.setSelection(new monaco.Range(
          targetLine, 1,
          endPosition?.lineNumber ?? targetLine,
          endPosition?.column ?? 1,
        ));
        // 延迟 500ms 等待连接/数据库切换的 setState 生效后再执行
        options.runAfterQueryContextReady();
      }
    }
  } else {
    options.applyQueryState(options.getCurrentQuery() ? `${options.getCurrentQuery()}\n${sqlText}` : sqlText);
    message.success(translate('query_editor.message.append_success'));
  }
};

/**
 * 监听由 TabManager 分发的专用注入事件。
 * 从 QueryEditor.tsx 抽出（超标债务文件只保留接线）；回调用 latest ref 读取
 * 最新 options，等价于原实现的 effect 重订阅行为。
 */
export const useAiSqlInsertToTabListener = (options: AiSqlInsertListenerOptions): void => {
  const latestOptionsRef = useRef(options);
  latestOptionsRef.current = options;

  useEffect(() => {
    const handleInsertSql = (event: Event): void => {
      createAiSqlInsertHandler(latestOptionsRef.current)(event as { detail?: AiSqlInsertEventDetail });
    };
    window.addEventListener(AI_SQL_INSERT_TO_TAB_EVENT, handleInsertSql as EventListener);
    return () => window.removeEventListener(AI_SQL_INSERT_TO_TAB_EVENT, handleInsertSql as EventListener);
  }, []);
};
