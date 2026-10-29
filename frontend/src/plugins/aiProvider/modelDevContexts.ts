const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const normalize = (value: string): string => value.trim().toLowerCase();

// Standard tiers buyers quote: a raw 1048576 or 1050000 is really "1M", and
// 512000 / 262144 / 202752 are really 500K / 256K / 200K.
const TIERS = [2_000_000, 1_500_000, 1_000_000, 500_000, 256_000, 200_000, 128_000, 64_000, 32_000];
const TIER_TOLERANCE = 0.06;

const rememberContext = (index: Map<string, number>, key: string, context: number) => {
  const id = normalize(key);
  if (!id || !Number.isFinite(context) || context <= 0) return;
  const previous = index.get(id);
  // A model listed by several providers keeps the largest supported window.
  if (previous === undefined || context > previous) index.set(id, context);
  const tail = id.split('/').pop();
  if (tail && tail !== id) {
    const tailPrevious = index.get(tail);
    if (tailPrevious === undefined || context > tailPrevious) index.set(tail, context);
  }
};

// models.dev ships providers → models → limit.context; index it by id and id tail.
export function indexModelDevContexts(raw: unknown): Map<string, number> {
  const index = new Map<string, number>();
  const root = asRecord(raw);
  if (!root) return index;
  for (const provider of Object.values(root)) {
    const models = asRecord(asRecord(provider)?.models);
    if (!models) continue;
    for (const [id, entry] of Object.entries(models)) {
      const model = asRecord(entry);
      const context = asRecord(model?.limit)?.context;
      if (typeof context !== 'number') continue;
      rememberContext(index, id, context);
      rememberContext(index, String(model?.id ?? ''), context);
      rememberContext(index, String(model?.canonical_model_id ?? ''), context);
    }
  }
  return index;
}

export function contextForModelId(index: Map<string, number>, id: string): number | undefined {
  const key = normalize(id);
  if (!key) return undefined;
  return index.get(key) ?? index.get(key.split('/').pop() || '');
}

// Snap to the nearest quoted tier so 1050000 renders as 1M, not 1.05M.
export const snapContextWindow = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  let best = Math.round(value);
  let bestGap = TIER_TOLERANCE;
  for (const tier of TIERS) {
    const gap = Math.abs(value - tier) / tier;
    if (gap <= bestGap) {
      bestGap = gap;
      best = tier;
    }
  }
  return best;
};

// Always render a tier: 1000000 → 1M, 500000 → 500K, 100000 → 100K.
export const formatContextWindow = (value: number | undefined): string => {
  if (!value || !Number.isFinite(value) || value <= 0) return '';
  const tier = snapContextWindow(value);
  if (tier >= 1_000_000) {
    const millions = Math.round((tier / 1_000_000) * 10) / 10;
    return `${millions}M`;
  }
  if (tier >= 1000) {
    const thousands = Math.round((tier / 1000) * 10) / 10;
    return `${thousands}K`;
  }
  return String(tier);
};

// Accepts 1M, 1.5m, 500K, 128k, or a plain token count like 1000000.
export const parseContextWindow = (text: string): number | null => {
  const raw = text.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!raw) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)([mk])?$/.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const value = unit === 'm' ? amount * 1_000_000 : unit === 'k' ? amount * 1000 : amount;
  if (!Number.isFinite(value) || value < 1024 || value > 8_000_000) return null;
  return Math.round(value);
};

// Bubbles offered for a set of models: their tiers first, then common defaults.
export function contextTiersFor(index: Map<string, number>, modelIds: string[]): number[] {
  const found = new Set<number>();
  for (const id of modelIds) {
    const context = contextForModelId(index, id);
    if (context) found.add(snapContextWindow(context));
  }
  const ordered = [...found].sort((a, b) => b - a);
  if (ordered.length === 0) return [1_000_000, 500_000, 256_000, 200_000, 128_000];
  return ordered;
}
