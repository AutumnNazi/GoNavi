import type * as MonacoNS from 'monaco-editor';

// Monaco 参数装饰：为当前 SQL 中出现的 :name 记号加高亮，提示可填值。
// 位置来自后端 AnalyzeQueryParameters 的语句拆分结果不可用（后端返回的是
// 语句级文本），这里用轻量正则在纯文本层定位——只做展示，不参与执行判定。

let decorationPool: string[] = [];

export function applyParamNameDecorations(
  editor: MonacoNS.editor.IStandaloneCodeEditor | null | undefined,
  monaco: typeof MonacoNS | null | undefined,
  paramNames: string[],
): void {
  if (!editor || !monaco) {
    return;
  }
  const model = editor.getModel();
  if (!model) {
    return;
  }
  const decorations: MonacoNS.editor.IModelDeltaDecoration[] = [];
  if (paramNames.length > 0) {
    const alternation = paramNames
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const pattern = new RegExp(`:(?:${alternation})\\b`, 'g');
    const text = model.getValue();
    let match = pattern.exec(text);
    while (match) {
      const start = model.getPositionAt(match.index);
      const end = model.getPositionAt(match.index + match[0].length);
      decorations.push({
        range: new monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
        options: {
          inlineClassName: 'gn-query-param-token',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
      if (match[0].length === 0) {
        break;
      }
      match = pattern.exec(text);
    }
  }
  decorationPool = editor.deltaDecorations(decorationPool, decorations);
}

export function clearParamNameDecorations(
  editor: MonacoNS.editor.IStandaloneCodeEditor | null | undefined,
): void {
  if (!editor) {
    return;
  }
  decorationPool = editor.deltaDecorations(decorationPool, []);
}
