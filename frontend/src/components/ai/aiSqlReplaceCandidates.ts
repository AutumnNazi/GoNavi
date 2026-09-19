import type { AIChatMessage } from '../../types';

const SQL_FENCE_PATTERN = /```sql[ \t]*\r?\n([\s\S]*?)```/gi;

/**
 * 从用户消息中提取 ```sql 围栏块作为“原 SQL”候选。
 *
 * 两条已知来源都符合该形态：
 * - “AI 诊断”注入的提示词（query_editor.ai_prompt.diagnose）把出错 SQL 包在 ```sql 围栏里；
 * - 用户手动把报错 SQL 粘贴进聊天时通常也粘贴为 sql 代码块。
 */
export const extractOriginalSqlCandidates = (content: string): string[] => {
  const source = String(content || '');
  if (!source) return [];
  const candidates: string[] = [];
  for (const match of source.matchAll(SQL_FENCE_PATTERN)) {
    const candidate = String(match[1] || '').trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
};

/**
 * 收集某条 assistant 消息对应的“原 SQL”候选：从该消息向前找最近的、
 * 带有 ```sql 围栏的用户消息（中间的追问没有围栏时继续回溯）。
 * 找不到时返回空数组，调用方回退为普通插入。
 */
export const collectOriginalSqlCandidatesForAssistant = (
  messages: Pick<AIChatMessage, 'id' | 'role' | 'content'>[],
  assistantMessageId: string,
): string[] => {
  if (!messages?.length || !assistantMessageId) return [];
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (assistantIndex < 0) return [];
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const candidates = extractOriginalSqlCandidates(message.content);
    if (candidates.length > 0) {
      return candidates;
    }
  }
  return [];
};
