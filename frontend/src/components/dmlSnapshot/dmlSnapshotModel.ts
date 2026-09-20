// 快照中心的数据归一化。
//
// 后端经 Wails 回来的 payload 一律当作不可信输入逐字段收敛：
// 快照来自磁盘上的 JSONL，可能被手工编辑或版本升级后字段缺失。

export type DMLSnapshotSummary = {
  id: string;
  createdAt: string;
  connection: string;
  driver: string;
  dbName: string;
  table: string;
  /** 该次变更**无法完整回滚**，UI 必须显式提示。 */
  cannotFullyRestore: boolean;
  skippedCount: number;
  statementCount: number;
};

export type DMLSkippedRow = {
  group: string;
  index: number;
  /** 已是 i18n key（后端不翻译），前端直接 t() 使用。 */
  reason: string;
};

export type DMLSnapshotDetail = DMLSnapshotSummary & {
  deletes: string[];
  updates: string[];
  inserts: string[];
  skipped: DMLSkippedRow[];
};

const toStringArray = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.map((item) => String(item ?? '')).filter((item) => item.trim() !== '')
    : []
);

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSummary = (source: any): DMLSnapshotSummary => ({
  id: String(source?.id ?? '').trim(),
  createdAt: String(source?.createdAt ?? '').trim(),
  connection: String(source?.connection ?? '').trim(),
  driver: String(source?.driver ?? '').trim(),
  dbName: String(source?.dbName ?? '').trim(),
  table: String(source?.table ?? '').trim(),
  cannotFullyRestore: source?.cannotFullyRestore === true,
  skippedCount: toFiniteNumber(source?.skippedCount),
  statementCount: toFiniteNumber(source?.statementCount),
});

export const normalizeDMLSnapshotList = (data: unknown): DMLSnapshotSummary[] => (
  Array.isArray(data)
    ? data.map(normalizeSummary).filter((item) => item.id !== '')
    : []
);

export const normalizeDMLSnapshotDetail = (data: any): DMLSnapshotDetail => ({
  ...normalizeSummary(data),
  deletes: toStringArray(data?.deletes),
  updates: toStringArray(data?.updates),
  inserts: toStringArray(data?.inserts),
  skipped: Array.isArray(data?.skipped)
    ? data.skipped.map((item: any) => ({
      group: String(item?.group ?? '').trim(),
      index: toFiniteNumber(item?.index),
      reason: String(item?.reason ?? '').trim(),
    }))
    : [],
});

// 回放顺序固定为 Deletes → Updates → Inserts：
// 先撤销本次新增，再还原被修改的行，最后补回被删除的行。
// 顺序颠倒会造成主键冲突（先 INSERT 再 DELETE 同一行）。
export const buildReverseScript = (detail: DMLSnapshotDetail): string => {
  const sections: string[] = [];
  const append = (label: string, statements: string[]) => {
    if (statements.length === 0) return;
    sections.push(`-- ${label}`);
    sections.push(...statements);
  };
  append('undo inserts', detail.deletes);
  append('restore updates', detail.updates);
  append('restore deletes', detail.inserts);
  return sections.join('\n');
};

export const countReverseStatements = (detail: DMLSnapshotDetail): number => (
  detail.deletes.length + detail.updates.length + detail.inserts.length
);
