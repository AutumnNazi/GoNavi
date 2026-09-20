export type DriverProgressStatus = 'start' | 'downloading' | 'done' | 'error' | 'canceled';

export type DriverProgressState = {
  status: DriverProgressStatus;
  message: string;
  percent: number;
};

export const DRIVER_PROGRESS_STATUSES: readonly DriverProgressStatus[] = ['start', 'downloading', 'done', 'error', 'canceled'];

export const isDriverProgressStatus = (value: unknown): value is DriverProgressStatus => (
  typeof value === 'string' && (DRIVER_PROGRESS_STATUSES as readonly string[]).includes(value)
);

export const isDriverProgressActiveStatus = (status?: DriverProgressStatus): boolean => (
  status === 'start' || status === 'downloading'
);

export const isDriverProgressTerminalStatus = (status?: DriverProgressStatus): boolean => (
  status === 'done' || status === 'error' || status === 'canceled'
);

const clampDriverProgressPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
};

export const normalizeDriverProgressUpdate = (
  previous: DriverProgressState | undefined,
  incoming: DriverProgressState,
): DriverProgressState => {
  const next: DriverProgressState = {
    status: incoming.status,
    message: String(incoming.message || '').trim(),
    percent: clampDriverProgressPercent(Number(incoming.percent || 0)),
  };

  if (next.status === 'start') {
    return {
      ...next,
      percent: 0,
    };
  }

  if (next.status === 'done') {
    return {
      ...next,
      percent: 100,
    };
  }

  if (next.status === 'error' || next.status === 'canceled') {
    return {
      ...next,
      percent: Math.max(clampDriverProgressPercent(previous?.percent || 0), next.percent),
    };
  }

  if (isDriverProgressTerminalStatus(previous?.status)) {
    return previous as DriverProgressState;
  }

  if (isDriverProgressActiveStatus(previous?.status)) {
    return {
      ...next,
      percent: Math.max(clampDriverProgressPercent(previous?.percent || 0), next.percent),
    };
  }

  return next;
};

export type DriverProgressDisplayStatus = 'normal' | 'exception' | 'active' | 'success';

/** Maps stored progress onto the card percent / Ant Progress status. */
export const resolveDriverProgressDisplay = (
  progress: DriverProgressState | undefined,
  fallbackReady = false,
): { percent: number; status: DriverProgressDisplayStatus } => {
  if (progress?.status === 'error') {
    return {
      percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      status: 'exception',
    };
  }
  if (progress && isDriverProgressActiveStatus(progress.status)) {
    return {
      percent: Math.max(1, Math.min(99, Math.round(progress.percent || 0))),
      status: 'active',
    };
  }
  if (progress?.status === 'done') {
    return { percent: 100, status: 'success' };
  }
  if (progress?.status === 'canceled') {
    return {
      percent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      status: 'normal',
    };
  }
  if (fallbackReady) {
    return { percent: 100, status: 'success' };
  }
  return { percent: 0, status: 'normal' };
};
