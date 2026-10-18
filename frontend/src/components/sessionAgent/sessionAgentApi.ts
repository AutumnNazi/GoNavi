/**
 * 会话管理前端 API seam：组件依赖本接口而非直接绑定，便于测试注入
 * （参照 sessionAssets/wailsSessionAssetsApi 模式）。对应后端
 * internal/sessionagent 的 SessionAgent* 绑定。
 */
import {
  SessionAgentList,
  SessionAgentDetail,
  SessionAgentReadPage,
  SessionAgentBlockContent,
  SessionAgentExportMarkdown,
  SessionAgentCopyResume,
  SessionAgentDelete,
  SessionAgentRevealPath,
  SessionAgentTimeGroups,
} from '../../../wailsjs/go/app/App';

/** 列表条目（对应后端 SessionMeta）。 */
export interface SessionAgentItem {
  providerId: string;
  sessionId: string;
  title: string;
  summary: string;
  projectDir: string;
  createdAt: number;
  lastActiveAt: number;
  sourcePath: string;
  resumeCommand: string;
}

/** 大内容引用（对应后端 ContentRef）。 */
export interface SessionContentRef {
  kind: 'jsonl' | 'file' | 'sidecar';
  offset?: number;
  len?: number;
  relPath?: string;
  pointer?: string;
}

/** 消息块（对应后端 SessionBlock）。 */
export interface SessionBlockView {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'image' | 'event' | 'step';
  text?: { text: string; full?: SessionContentRef };
  thinking?: { text: string; summary?: string; redacted?: boolean; full?: SessionContentRef };
  toolCall?: {
    id: string;
    rawName: string;
    kind: string;
    title: string;
    detail?: string;
    inputPreview?: string;
    inputTotalLen?: number;
    inputFull?: SessionContentRef;
    diff?: { files: Array<{ path: string; op: string; added: number; removed: number }>; added: number; removed: number };
    byUser?: boolean;
  };
  toolResult?: {
    callId: string;
    status: string;
    preview?: string;
    totalLen?: number;
    truncated?: boolean;
    full?: SessionContentRef;
    exitCode?: number;
  };
  event?: { kind: string; text?: string; url?: string };
}

/** 消息（对应后端 SessionMessage）。 */
export interface SessionMessageView {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  ts: number;
  id?: string;
  turnId?: string;
  injected?: boolean;
  blocks?: SessionBlockView[];
}

/** 轮次索引（对应后端 TurnIndex）。 */
export interface SessionTurnView {
  turnId: string;
  firstMessageIndex: number;
  lastMessageIndex: number;
  questionPreview: string;
  ts: number;
  stepCount: number;
  errorCount: number;
  hasFinalReply: boolean;
  aborted: boolean;
}

/** 按需内容一页（对应后端 BlockContent）。 */
export interface SessionBlockContent {
  text: string;
  totalLen: number;
  truncated: boolean;
  nextOffset?: number;
}

export type SessionAgentApi = {
  list(provider: string, search: string): Promise<SessionAgentItem[]>;
  detail(provider: string, sourcePath: string): Promise<{ messages: SessionMessageView[]; turns: SessionTurnView[]; cached: boolean } | null>;
  readPage(provider: string, sourcePath: string, offset: number, limit: number): Promise<SessionMessageView[]>;
  blockContent(provider: string, sourcePath: string, ref: SessionContentRef, offset: number, limit: number): Promise<SessionBlockContent | null>;
  exportMarkdown(provider: string, sourcePath: string): Promise<string>;
  copyResume(provider: string, sessionId: string): Promise<string>;
  delete(provider: string, sourcePath: string, sessionId: string): Promise<boolean>;
  revealPath(sourcePath: string): Promise<string>;
  timeGroups(provider: string, search: string): Promise<{ groups: Record<string, SessionAgentItem[]>; total: number }>;
};

const unwrap = <T,>(result: { success?: boolean; data?: unknown } | null | undefined): T | null =>
  result?.success ? ((result.data ?? null) as T | null) : null;

export const wailsSessionAgentApi: SessionAgentApi = {
  async list(provider, search) {
    const result = await SessionAgentList(provider, search);
    return unwrap<{ items: SessionAgentItem[] }>(result)?.items ?? [];
  },
  async detail(provider, sourcePath) {
    return unwrap<{ messages: SessionMessageView[]; turns: SessionTurnView[]; cached: boolean }>(
      await SessionAgentDetail(provider, sourcePath),
    );
  },
  async readPage(provider, sourcePath, offset, limit) {
    const result = await SessionAgentReadPage(provider, sourcePath, offset, limit);
    return unwrap<{ messages: SessionMessageView[] }>(result)?.messages ?? [];
  },
  async blockContent(provider, sourcePath, ref, offset, limit) {
    return unwrap<SessionBlockContent>(
      await SessionAgentBlockContent(provider, sourcePath, ref, offset, limit),
    );
  },
  async exportMarkdown(provider, sourcePath) {
    const result = await SessionAgentExportMarkdown(provider, sourcePath);
    return unwrap<{ markdown: string }>(result)?.markdown ?? '';
  },
  async copyResume(provider, sessionId) {
    const result = await SessionAgentCopyResume(provider, sessionId);
    return unwrap<{ command: string }>(result)?.command ?? '';
  },
  async delete(provider, sourcePath, sessionId) {
    const result = await SessionAgentDelete(provider, sourcePath, sessionId);
    return Boolean(result?.success);
  },
  async revealPath(sourcePath) {
    const result = await SessionAgentRevealPath(sourcePath);
    return unwrap<{ path: string }>(result)?.path ?? '';
  },
  async timeGroups(provider, search) {
    return (
      unwrap<{ groups: Record<string, SessionAgentItem[]>; total: number }>(
        await SessionAgentTimeGroups(provider, search),
      ) ?? { groups: {}, total: 0 }
    );
  },
};
