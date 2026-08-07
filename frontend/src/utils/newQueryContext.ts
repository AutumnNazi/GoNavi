export interface NewQueryContextLike {
  connectionId?: unknown;
  dbName?: unknown;
}

export interface NewQueryContext {
  connectionId: string;
  dbName: string;
}

const normalizeValidContext = (
  context: NewQueryContextLike | null | undefined,
  validConnectionIds: ReadonlySet<string>,
): NewQueryContext | null => {
  const connectionId = String(context?.connectionId || '').trim();
  if (!connectionId || !validConnectionIds.has(connectionId)) {
    return null;
  }
  return {
    connectionId,
    dbName: String(context?.dbName ?? ''),
  };
};

export const resolveNewQueryContext = ({
  sidebarContext,
  activeTab,
  validConnectionIds,
}: {
  sidebarContext?: NewQueryContextLike | null;
  activeTab?: NewQueryContextLike | null;
  validConnectionIds: ReadonlySet<string>;
}): NewQueryContext => (
  normalizeValidContext(sidebarContext, validConnectionIds)
  || normalizeValidContext(activeTab, validConnectionIds)
  || { connectionId: '', dbName: '' }
);
