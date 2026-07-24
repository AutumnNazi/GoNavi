import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createDebouncedPersistStorage,
  type FlushablePersistStorage,
} from "./debouncedPersistStorage";

interface TestState {
  value: number;
}

const createFlushableStorage = (
  baseStorage: StateStorage,
  flushEventTarget: EventTarget | null = null,
): FlushablePersistStorage<TestState> => {
  const storage = createDebouncedPersistStorage<TestState>(
    () => baseStorage,
    {
      debounceMs: 60_000,
      enabled: true,
      flushEventTarget,
    },
  );
  if (!storage || !("flush" in storage)) {
    throw new Error("expected a flushable persist storage");
  }
  return storage;
};

const persistedValue = (value: number) => ({
  state: { value },
  version: 1,
});

describe("debounced persist storage", () => {
  it("shares one pending promise across a large burst of writes", async () => {
    const baseStorage: StateStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const storage = createFlushableStorage(baseStorage);

    const pendingWrites = Array.from({ length: 1_000 }, (_, index) =>
      storage.setItem("store", persistedValue(index)),
    );

    expect(new Set(pendingWrites).size).toBe(1);
    await storage.removeItem("store");
    await Promise.all(pendingWrites);
  });

  it("does not settle a write queued while the previous flush is in flight", async () => {
    const writes: Array<{
      value: string;
      resolve: () => void;
    }> = [];
    const baseStorage: StateStorage = {
      getItem: () => null,
      setItem: (_name, value) => new Promise<void>((resolve) => {
        writes.push({ value, resolve });
      }),
      removeItem: () => undefined,
    };
    const storage = createFlushableStorage(baseStorage);

    const firstWrite = storage.setItem("store", persistedValue(1));
    const firstFlush = storage.flush();
    expect(writes).toHaveLength(1);

    const secondWrite = storage.setItem("store", persistedValue(2));
    let secondSettled = false;
    void Promise.resolve(secondWrite).then(() => {
      secondSettled = true;
    });

    writes[0].resolve();
    await Promise.all([Promise.resolve(firstWrite), firstFlush]);
    await Promise.resolve();

    expect(secondSettled).toBe(false);
    expect(writes).toHaveLength(1);

    const secondFlush = storage.flush();
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1].value).state.value).toBe(2);
    writes[1].resolve();
    await Promise.all([Promise.resolve(secondWrite), secondFlush]);
  });

  it("flushes the latest snapshot synchronously when the page is hidden", async () => {
    const eventTarget = new EventTarget();
    let persisted: string | null = null;
    const baseStorage: StateStorage = {
      getItem: () => persisted,
      setItem: (_name, value) => {
        persisted = value;
      },
      removeItem: () => {
        persisted = null;
      },
    };
    const storage = createFlushableStorage(baseStorage, eventTarget);

    const firstWrite = storage.setItem("store", persistedValue(1));
    const latestWrite = storage.setItem("store", persistedValue(2));
    eventTarget.dispatchEvent(new Event("pagehide"));

    expect(JSON.parse(persisted || "{}").state.value).toBe(2);
    await Promise.all([Promise.resolve(firstWrite), Promise.resolve(latestWrite)]);
  });
});
