const CURSOR_CLI_EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
const CURSOR_CLI_EFFORT_BY_LENGTH = ['minimal', 'medium', 'xhigh', 'ultra', 'high', 'none', 'max', 'low'] as const;

export type CursorCLIModelParts = { family: string; effort: string; fast: boolean };

export const isCursorCLIEffortToken = (value: string): boolean =>
  CURSOR_CLI_EFFORT_ORDER.includes(String(value || '').trim().toLowerCase() as typeof CURSOR_CLI_EFFORT_ORDER[number]);

export const parseCursorCLIModelID = (model: string): CursorCLIModelParts => {
  let rest = String(model || '').trim();
  if (!rest) return { family: '', effort: '', fast: false };
  const fast = rest.toLowerCase().endsWith('-fast');
  if (fast) rest = rest.slice(0, -'-fast'.length);
  const lower = rest.toLowerCase();
  for (const token of CURSOR_CLI_EFFORT_BY_LENGTH) {
    const suffix = `-${token}`;
    if (lower.endsWith(suffix)) {
      const family = rest.slice(0, -suffix.length);
      if (family.trim()) return { family, effort: token, fast };
      break;
    }
  }
  return { family: rest, effort: '', fast };
};

export const applyCursorCLIModelEffort = (model: string, effort: string, allowed?: string[]): string => {
  const current = String(model || '').trim();
  const nextEffort = String(effort || '').trim().toLowerCase();
  if (!current) return current;
  const parts = parseCursorCLIModelID(current);
  if (!parts.family) return current;
  const assemble = (token: string) => `${parts.family}${token ? `-${token}` : ''}${parts.fast ? '-fast' : ''}`;
  const next = nextEffort && isCursorCLIEffortToken(nextEffort) ? assemble(nextEffort) : assemble('');
  if (next === current) return current;
  if (allowed && allowed.length && !allowed.includes(next)) return current;
  return next;
};
