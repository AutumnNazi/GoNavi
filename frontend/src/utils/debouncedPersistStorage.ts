import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from "zustand/middleware";

export interface DebouncedPersistStorageOptions {
  debounceMs: number;
  enabled: boolean;
  flushEventTarget?: Pick<EventTarget, "addEventListener"> | null;
}

export interface FlushablePersistStorage<S> extends PersistStorage<S> {
  flush: () => Promise<void>;
}

export const createDebouncedPersistStorage = <S>(
  getStorage: () => StateStorage,
  options: DebouncedPersistStorageOptions,
): PersistStorage<S> | FlushablePersistStorage<S> | undefined => {
  const baseStorage = createJSONStorage<S>(getStorage);
  if (!baseStorage || !options.enabled) {
    return baseStorage;
  }

  type PersistedValue = Parameters<PersistStorage<S>["setItem"]>[1];
  type PendingOperation =
    | { kind: "set"; name: string; value: PersistedValue }
    | { kind: "remove"; name: string };
  type PendingBatch = {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  };

  let pendingOperation: PendingOperation | null = null;
  let pendingBatch: PendingBatch | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFlushRequested = false;
  let operationInFlight = false;
  let activeBatchPromise: Promise<void> | null = null;
  let listenersBound = false;

  const createPendingBatch = (): PendingBatch => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((batchResolve, batchReject) => {
      resolve = batchResolve;
      reject = batchReject;
    });
    // Zustand intentionally ignores persistence promises for ordinary state
    // updates. Keep the rejection observable to explicit callers without
    // producing an unhandled rejection for fire-and-forget updates.
    void promise.catch(() => undefined);
    return { promise, resolve, reject };
  };

  const clearPendingTimer = () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const finishOperation = (
    batch: PendingBatch,
    succeeded: boolean,
    error?: unknown,
  ) => {
    operationInFlight = false;
    activeBatchPromise = null;
    if (succeeded) {
      batch.resolve();
    } else {
      batch.reject(error);
    }

    if (pendingFlushRequested) {
      startPendingOperation();
    }
  };

  const startPendingOperation = () => {
    if (operationInFlight || !pendingOperation || !pendingBatch) {
      return;
    }

    clearPendingTimer();
    const operation = pendingOperation;
    const batch = pendingBatch;
    pendingOperation = null;
    pendingBatch = null;
    pendingFlushRequested = false;
    operationInFlight = true;
    activeBatchPromise = batch.promise;

    let result: unknown;
    try {
      result = operation.kind === "set"
        ? baseStorage.setItem(operation.name, operation.value)
        : baseStorage.removeItem(operation.name);
    } catch (error) {
      finishOperation(batch, false, error);
      return;
    }

    if (
      result &&
      typeof (result as PromiseLike<void>).then === "function"
    ) {
      void Promise.resolve(result).then(
        () => finishOperation(batch, true),
        (error) => finishOperation(batch, false, error),
      );
      return;
    }

    finishOperation(batch, true);
  };

  const flushPendingWrite = (): Promise<void> => {
    clearPendingTimer();
    if (!pendingOperation || !pendingBatch) {
      return activeBatchPromise ?? Promise.resolve();
    }

    const promise = pendingBatch.promise;
    pendingFlushRequested = true;
    startPendingOperation();
    return promise;
  };

  const bindFlushListeners = () => {
    if (listenersBound) {
      return;
    }
    const eventTarget = options.flushEventTarget === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.flushEventTarget;
    if (!eventTarget) {
      return;
    }
    listenersBound = true;
    const handleFlush = () => {
      void flushPendingWrite().catch(() => undefined);
    };
    eventTarget.addEventListener("pagehide", handleFlush, { capture: true });
    eventTarget.addEventListener("beforeunload", handleFlush, { capture: true });
  };

  return {
    getItem: baseStorage.getItem,
    setItem: (name, value) => {
      bindFlushListeners();
      pendingOperation = { kind: "set", name, value };
      if (!pendingBatch) {
        pendingBatch = createPendingBatch();
      }
      if (!pendingFlushRequested) {
        clearPendingTimer();
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          void flushPendingWrite().catch(() => undefined);
        }, options.debounceMs);
      }
      return pendingBatch.promise;
    },
    removeItem: (name) => {
      bindFlushListeners();
      pendingOperation = { kind: "remove", name };
      if (!pendingBatch) {
        pendingBatch = createPendingBatch();
      }
      const promise = pendingBatch.promise;
      pendingFlushRequested = true;
      clearPendingTimer();
      startPendingOperation();
      return promise;
    },
    flush: flushPendingWrite,
  };
};
