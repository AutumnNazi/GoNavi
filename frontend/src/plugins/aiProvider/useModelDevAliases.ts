import { useEffect, useState } from 'react';
import { indexModelDevCatalog } from './modelDevAliases';

const MODELS_DEV_URL = 'https://models.dev/api.json';

let cached: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

const loadCatalog = async (): Promise<Map<string, string>> => {
  if (cached) return cached;
  if (typeof fetch !== 'function') return new Map();
  try {
    const response = await fetch(MODELS_DEV_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return new Map();
    const index = indexModelDevCatalog(await response.json());
    cached = index;
    return index;
  } catch {
    return new Map();
  }
};

export function useModelDevAliases(): Map<string, string> {
  const [index, setIndex] = useState<Map<string, string>>(cached ?? new Map());
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

export const resetModelDevAliasesForTests = () => {
  cached = null;
  inflight = null;
};
