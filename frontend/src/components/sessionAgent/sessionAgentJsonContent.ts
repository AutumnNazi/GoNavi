/**
 * 会话正文里「整条内容是一个 JSON 对象」的识别与拆解。
 *
 * Codex 的子 Agent（审批 / 交付验证 / 市场审查）把结构化结论直接作为助手
 * 消息发出，例如：
 *
 *   {"summary":"审查被环境能力阻塞：…","verdict":"blocked","findings":[]}
 *
 * 这类内容是机器对机器的协议，不是对话。按普通段落渲染就是一坨单行 JSON，
 * 连换行都没有。这里把它拆成两部分：
 *
 * - 正文：顶层最长的字符串值（承载自然语言结论的那个字段）
 * - 其余字段：收成一行可展开的摘要，展开后能看到原始内容
 *
 * 刻意不硬编码任何工具的 schema——换个工具出现新的字段名同样能通用。
 */

/** 一个非正文字段的摘要行。文案在组件里按 i18n 拼，这里只给结构。 */
export interface JsonMessageMetaRow {
  /** 原始字段名。 */
  key: string;
  /** 字段类别：标量 / 数组 / 对象。 */
  kind: 'scalar' | 'array' | 'object';
  /** kind 为 scalar 时的原值。 */
  value?: string;
  /** kind 为 array / object 时的条目数。 */
  count?: number;
  /** 展开后的完整内容；标量字段没有这一项。 */
  detail?: string;
}

/** 一条 JSON 消息的拆解结果。 */
export interface JsonMessageView {
  /** 承载自然语言的正文；没有可用正文时为空串。 */
  prose: string;
  /** 正文来自哪个字段；没有正文时为空串。 */
  proseField: string;
  /** 其余字段的摘要行。 */
  meta: JsonMessageMetaRow[];
  /** 原始 JSON 文本。 */
  raw: string;
}

const pretty = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
};

/**
 * 判定并拆解一条 JSON 消息。不是「像 JSON 的正文」就返回 null，交给调用方
 * 按普通文本渲染。
 *
 * 刻意保守，避免把工具的原始输出改头换面：
 * - 顶层必须是对象（数组保持原样）
 * - 对象至少两个字段；只有一个字段时，必须是字符串值（`{"outcome":"allow"}`
 *   这类纯结论要处理，`{"port":8080}` 这种原始输出保持原样）
 */
export const parseJsonMessage = (text: string | null | undefined): JsonMessageView | null => {
  const trimmed = (text ?? '').trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const only = entries[0][1];
    if (typeof only !== 'string') return null;
  }

  // 正文 = 顶层最长的字符串值。子 Agent 的枚举字段（allow / blocked /
  // medium）都很短，真正的结论句一定是最长的那个。
  let proseField = '';
  let prose = '';
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue;
    if (value.trim().length > prose.length) {
      prose = value.trim();
      proseField = key;
    }
  }

  const meta: JsonMessageMetaRow[] = [];
  for (const [key, value] of entries) {
    if (key === proseField) continue;
    if (value === null) {
      meta.push({ key, kind: 'scalar', value: 'null' });
    } else if (Array.isArray(value)) {
      meta.push({ key, kind: 'array', count: value.length, detail: pretty(value) });
    } else if (typeof value === 'object') {
      meta.push({
        key,
        kind: 'object',
        count: Object.keys(value as object).length,
        detail: pretty(value),
      });
    } else {
      meta.push({ key, kind: 'scalar', value: String(value) });
    }
  }

  return { prose, proseField, meta, raw: trimmed };
};
