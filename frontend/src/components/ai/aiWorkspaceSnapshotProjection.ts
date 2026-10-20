import type { SqlLog } from '../../store';
import { serializeShortcutOptionsForWorkspace } from './aiRunHarnessClient';

export const workspaceText = (value: unknown): string => String(value || '').trim();
export const truncateWorkspaceText = (value: unknown, limit = 20_000): string => {
  const result = String(value || '');
  if (result.length <= limit) return result;
  return result.slice(0, Math.floor(limit / 2)) + '\n/* ... snapshot truncated ... */\n' + result.slice(-Math.floor(limit / 2));
};

type TextEntry = { id?: unknown; name?: unknown; sql?: unknown; body?: unknown; content?: unknown };
type DirectoryEntry = { path?: unknown; name?: unknown };
interface ProjectionInput {
  savedQueries?: readonly TextEntry[];
  sqlSnippets?: readonly TextEntry[];
  externalSQLDirectories?: readonly DirectoryEntry[];
  sqlLogs?: readonly SqlLog[];
  shortcutOptions?: unknown;
}

function memoizeProjection<Input, Output>(project: (input: Input) => Output) {
  let previous: { input: Input; output: Output } | undefined;
  return (input: Input): Output => {
    if (!previous || !Object.is(previous.input, input)) previous = { input, output: project(input) };
    return previous.output;
  };
}

// Cache immutable store slices independently. Never cache tabs here: their live
// drafts can change outside the store before an explicit immediate publication.
export function createWorkspaceSnapshotProjection() {
  const savedQueries = memoizeProjection((input: ProjectionInput['savedQueries']) => (Array.isArray(input) ? input : []).map((query: TextEntry) => ({
    id: workspaceText(query.id), name: workspaceText(query.name), content: truncateWorkspaceText(query.sql || query.content),
  })));
  const snippets = memoizeProjection((input: ProjectionInput['sqlSnippets']) => (Array.isArray(input) ? input : []).map((snippet: TextEntry) => ({
    id: workspaceText(snippet.id), name: workspaceText(snippet.name), content: truncateWorkspaceText(snippet.body || snippet.content),
  })));
  const directories = memoizeProjection((input: ProjectionInput['externalSQLDirectories']) => (Array.isArray(input) ? input : [])
    .map((directory: DirectoryEntry) => workspaceText(directory.path || directory.name)).filter(Boolean));
  const shortcuts = memoizeProjection(serializeShortcutOptionsForWorkspace);
  const activity = memoizeProjection((input: ProjectionInput['sqlLogs']) => (Array.isArray(input) ? input : [])
    .filter((log: SqlLog) => log && !log.hiddenFromRecent).slice(-50).map((log: SqlLog) => ({
      id: workspaceText(log.id), statement: truncateWorkspaceText(log.sql, 8_000), status: workspaceText(log.status),
      createdAt: new Date(Number(log.timestamp) || Date.now()).toISOString(),
    })));
  return (state: ProjectionInput) => ({
    savedQueries: savedQueries(state.savedQueries), snippets: snippets(state.sqlSnippets),
    externalSqlDirectories: directories(state.externalSQLDirectories), shortcuts: shortcuts(state.shortcutOptions),
    sqlActivity: activity(state.sqlLogs),
  });
}
