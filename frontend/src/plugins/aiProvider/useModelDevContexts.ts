import { useEffect, useState } from 'react';
import { indexModelDevContexts } from './modelDevContexts';

const MODELS_DEV_URL = 'https://models.dev/api.json';

let cached: Map<string, number> | null = null;
let inflight: Promise<Map<string, number>> | null = null;

const loadCatalog = async (): Promise<Map<string, number>> => {
  if (cached) return cached;
  if (typeof fetch !== 'function') return new Map();
  try {
    const response = await fetch(MODELS_DEV_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return new Map();
    const index = indexModelDevContexts(await response.json());
    cached = index;
    return index;
  } catch {
    return new Map();
  }
};

export function useModelDevContexts(): Map<string, number> {
  const [index, setIndex] = useState<Map<string, number>>(cached ?? new Map());
  useEffect(() => {
    if (cached) {
      setIndex(cached);
      return;
    }
    inflight ??= loadCatalog();
    void inflight.then((next) => setIndex(next));
  }, []);
  return index;
}

export const resetModelDevContextsForTests = () => {
  cached = null;
  inflight = null;
};
