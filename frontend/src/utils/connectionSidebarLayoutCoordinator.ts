import type {
  ConnectionSidebarLayout,
  ConnectionSidebarLayoutInput,
  SaveConnectionSidebarLayoutInput,
  SaveConnectionSidebarLayoutResult,
} from '../types';

export interface ConnectionSidebarLayoutBackend {
  BootstrapConnectionSidebarLayout?: (
    input: ConnectionSidebarLayoutInput,
  ) => Promise<ConnectionSidebarLayout>;
  SaveConnectionSidebarLayout?: (
    input: SaveConnectionSidebarLayoutInput,
  ) => Promise<SaveConnectionSidebarLayoutResult>;
}

export interface ConnectionSidebarLayoutStore {
  getLayout: () => ConnectionSidebarLayoutInput;
  replaceLayout: (layout: ConnectionSidebarLayoutInput) => void;
  subscribe: (listener: () => void) => () => void;
}

export interface ConnectionSidebarLayoutBootstrapResult {
  available: boolean;
  initialized: boolean;
  revision: number;
}

export interface ConnectionSidebarLayoutCoordinator {
  bootstrap: () => Promise<ConnectionSidebarLayoutBootstrapResult>;
  flush: () => Promise<void>;
  dispose: () => void;
}

interface CreateConnectionSidebarLayoutCoordinatorArgs {
  backend?: ConnectionSidebarLayoutBackend;
  store: ConnectionSidebarLayoutStore;
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

const cloneLayout = (
  layout: ConnectionSidebarLayoutInput,
): ConnectionSidebarLayoutInput => ({
  connectionTags: layout.connectionTags.map((tag) => ({
    ...tag,
    connectionIds: [...tag.connectionIds],
    childOrder: tag.childOrder ? [...tag.childOrder] : undefined,
  })),
  sidebarRootOrder: [...layout.sidebarRootOrder],
});

const layoutFingerprint = (layout: ConnectionSidebarLayoutInput): string =>
  JSON.stringify(layout);

export const createConnectionSidebarLayoutCoordinator = (
  args: CreateConnectionSidebarLayoutCoordinatorArgs,
): ConnectionSidebarLayoutCoordinator => {
  let disposed = false;
  let bootstrapPromise: Promise<ConnectionSidebarLayoutBootstrapResult> | null = null;
  let revision = 0;
  let unsubscribe: (() => void) | null = null;
  let pendingLayout: ConnectionSidebarLayoutInput | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlightSave: Promise<void> | null = null;
  let lastObservedFingerprint = '';
  let applyingRemoteLayout = false;
  const debounceMs = args.debounceMs ?? 160;

  const clearPendingTimer = () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const savePendingLayout = async (): Promise<void> => {
    clearPendingTimer();
    if (inFlightSave) {
      return inFlightSave;
    }
    const saveLayout = args.backend?.SaveConnectionSidebarLayout;
    const layout = pendingLayout;
    pendingLayout = null;
    if (
      disposed
      || typeof saveLayout !== 'function'
      || !layout
    ) {
      return;
    }
    let saveFailed = false;
    inFlightSave = (async () => {
      try {
        const result = await saveLayout({
          expectedRevision: revision,
          layout: cloneLayout(layout),
        });
        revision = result.layout.revision;
        if (result.conflict && !disposed) {
          const authoritativeLayout = cloneLayout(result.layout);
          pendingLayout = null;
          clearPendingTimer();
          lastObservedFingerprint = layoutFingerprint(authoritativeLayout);
          applyingRemoteLayout = true;
          try {
            args.store.replaceLayout(authoritativeLayout);
          } finally {
            applyingRemoteLayout = false;
          }
        }
      } catch (error) {
        saveFailed = true;
        pendingLayout ??= cloneLayout(layout);
        args.onError?.(error);
        throw error;
      }
    })().finally(() => {
      inFlightSave = null;
      if (!disposed && !saveFailed && pendingLayout) {
        void savePendingLayout().catch(() => undefined);
      }
    });
    return inFlightSave;
  };

  const flush = async (): Promise<void> => {
    clearPendingTimer();
    while (inFlightSave || pendingLayout) {
      if (inFlightSave) {
        await inFlightSave;
      } else {
        await savePendingLayout();
      }
    }
  };

  const startSubscription = () => {
    if (unsubscribe || typeof args.backend?.SaveConnectionSidebarLayout !== 'function') {
      return;
    }
    lastObservedFingerprint = layoutFingerprint(args.store.getLayout());
    unsubscribe = args.store.subscribe(() => {
      if (disposed || applyingRemoteLayout) return;
      const layout = cloneLayout(args.store.getLayout());
      const fingerprint = layoutFingerprint(layout);
      if (fingerprint === lastObservedFingerprint) return;
      lastObservedFingerprint = fingerprint;
      pendingLayout = layout;
      clearPendingTimer();
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        void savePendingLayout().catch(() => undefined);
      }, debounceMs);
    });
  };

  const bootstrap = (): Promise<ConnectionSidebarLayoutBootstrapResult> => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      const bootstrapLayout = args.backend?.BootstrapConnectionSidebarLayout;
      if (typeof bootstrapLayout !== 'function') {
        return { available: false, initialized: false, revision: 0 };
      }
      let layout: ConnectionSidebarLayout;
      try {
        layout = await bootstrapLayout(cloneLayout(args.store.getLayout()));
      } catch (error) {
        args.onError?.(error);
        return { available: false, initialized: false, revision: 0 };
      }
      if (!disposed && layout.initialized) {
        args.store.replaceLayout(cloneLayout(layout));
      }
      revision = layout.revision;
      if (!disposed) {
        startSubscription();
      }
      return {
        available: true,
        initialized: layout.initialized,
        revision: layout.revision,
      };
    })();
    return bootstrapPromise;
  };

  return {
    bootstrap,
    flush,
    dispose: () => {
      disposed = true;
      clearPendingTimer();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
};
