const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const normalize = (value: string): string => value.trim().toLowerCase();

const remember = (index: Map<string, string>, key: string, name: string) => {
  const id = normalize(key);
  if (!id || index.has(id)) return;
  index.set(id, name);
  const tail = id.split('/').pop();
  if (tail && tail !== id && !index.has(tail)) index.set(tail, name);
};

// models.dev ships providers → models; we keep one alias per id / canonical tail.
export function indexModelDevCatalog(raw: unknown): Map<string, string> {
  const index = new Map<string, string>();
  const root = asRecord(raw);
  if (!root) return index;
  for (const provider of Object.values(root)) {
    const models = asRecord(asRecord(provider)?.models);
    if (!models) continue;
    for (const [id, entry] of Object.entries(models)) {
      const model = asRecord(entry);
      const name = String(model?.name ?? '').trim();
      if (!name) continue;
      remember(index, id, name);
      remember(index, String(model?.id ?? ''), name);
      remember(index, String(model?.canonical_model_id ?? ''), name);
    }
  }
  return index;
}

export function aliasForModelId(index: Map<string, string>, id: string): string {
  const key = normalize(id);
  if (!key) return '';
  return index.get(key) || index.get(key.split('/').pop() || '') || '';
}

export function modelOptionLabel(index: Map<string, string>, id: string, fallback = ''): string {
  return aliasForModelId(index, id) || fallback || id;
}
