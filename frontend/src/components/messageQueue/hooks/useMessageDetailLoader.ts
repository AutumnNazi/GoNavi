import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { DBQuery } from '../../../../wailsjs/go/app/App';
import type { SavedConnection } from '../../../types';
import { buildRpcConnectionConfig } from '../../../utils/connectionRpcConfig';
import {
  buildMessageDetailCommand,
  hasMessagePayload,
  normalizeRows,
  type WorkbenchMessage,
} from '../messageQueueWorkbenchModel';

// 详情缓存条数上限：每条可能是十几 MB 的 payload，会常驻在 WebView 内存里。
export const MAX_CACHED_MESSAGE_DETAILS = 20;

type MessageDetailTarget = Pick<WorkbenchMessage, 'id' | 'destination' | 'row'>;
type MessageDetailRow = Record<string, any>;

export interface UseMessageDetailLoaderInput {
  connection: SavedConnection | null;
  sourceType?: string;
  executionDbName: string;
  messages: WorkbenchMessage[];
  selectedMessage: WorkbenchMessage | null;
  t: (key: string) => string;
}

// 按插入顺序淘汰最早的缓存（消息 id 不是整数，对象键保持插入顺序）。
const cacheDetail = (
  current: Record<string, MessageDetailRow>,
  id: string,
  row: MessageDetailRow,
): Record<string, MessageDetailRow> => {
  const next = { ...current };
  delete next[id];
  next[id] = row;
  const ids = Object.keys(next);
  for (let index = 0; index < ids.length - MAX_CACHED_MESSAGE_DETAILS; index += 1) {
    delete next[ids[index]];
  }
  return next;
};

/**
 * Loads message payloads on demand for metadata-only Kafka rows.
 * In-flight requests are de-duplicated so a click plus the selection effect issue one query.
 */
export const useMessageDetailLoader = ({
  connection, sourceType, executionDbName, messages, selectedMessage, t,
}: UseMessageDetailLoaderInput) => {
  const [details, setDetails] = useState<Record<string, MessageDetailRow>>({});
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(() => new Set());
  const inFlightRef = useRef(new Set<string>());
  const attemptedRef = useRef(new Set<string>());
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedMessage?.id ?? null;

  const setLoading = useCallback((id: string, loading: boolean) => {
    setLoadingIds((current) => {
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const loadDetail = useCallback(async (item: MessageDetailTarget) => {
    if (!connection || hasMessagePayload(item.row)) return;
    if (detailsRef.current[item.id] || inFlightRef.current.has(item.id)) return;
    const command = buildMessageDetailCommand(sourceType, item.destination, item.row);
    if (!command) return;
    inFlightRef.current.add(item.id);
    attemptedRef.current.add(item.id);
    setLoading(item.id, true);
    let failure = '';
    try {
      const result = await DBQuery(buildRpcConnectionConfig(connection.config) as any, executionDbName, command);
      const row = result?.success ? normalizeRows(result.data)[0] : undefined;
      if (row) {
        setDetails((current) => cacheDetail(current, item.id, row));
      } else if (result?.success) {
        failure = t('message_queue_workbench.message.not_found');
      } else {
        failure = result?.message || t('message_queue_workbench.message.load_failed');
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      inFlightRef.current.delete(item.id);
      setLoading(item.id, false);
    }
    // 用户已经切到别的消息时，不再弹出旧消息的失败提示。
    if (failure && selectedIdRef.current === item.id) {
      void message.error(failure);
    }
  }, [connection, executionDbName, setLoading, sourceType, t]);

  // 「跟随最新消息」会自动选中最新一条：选中即加载，每条只自动尝试一次。
  useEffect(() => {
    if (!selectedMessage || attemptedRef.current.has(selectedMessage.id)) return;
    void loadDetail(selectedMessage);
  }, [selectedMessage, loadDetail]);

  // 消息被清空或滚出可见上限时一起释放详情缓存。
  useEffect(() => {
    const visible = new Set(messages.map((item) => item.id));
    attemptedRef.current.forEach((id) => {
      if (!visible.has(id)) attemptedRef.current.delete(id);
    });
    setDetails((current) => {
      const kept = Object.keys(current).filter((id) => visible.has(id));
      if (kept.length === Object.keys(current).length) return current;
      return Object.fromEntries(kept.map((id) => [id, current[id]]));
    });
  }, [messages]);

  return { details, loadingIds, loadDetail };
};
