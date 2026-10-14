import { describe, expect, it, vi } from "vitest";
import {
  buildIndexedWriteFlushBatchMetrics,
  IndexedWriteBufferService,
  IndexedWriteFlushExecutorService,
  mapIndexedWriteFlushExecutorResult,
} from "../../search";

function createExecutor(options: {
  pending: Map<number, string>;
  inflight?: Map<number, string>;
  isAvailable?: () => boolean;
  ensureReady?: () => Promise<boolean>;
  persist?: (entries: string[]) => Promise<{ persisted: number } | void>;
  afterPersist?: (input: { entries: string[]; persistEntries: string[]; result: { persisted: number } | void }) => Promise<Record<string, unknown> | void>;
  shouldRetainBatch?: (error: unknown) => boolean;
  prepareBatch?: (entries: string[]) => Promise<boolean>;
  waitForCapacity?: () => Promise<void>;
  nowValues?: number[];
}) {
  const inflight = options.inflight ?? new Map<number, string>();
  const buffer = new IndexedWriteBufferService(options.pending, inflight);
  const recordDuration = vi.fn();
  const waitForCapacity = vi.fn(options.waitForCapacity ?? (async () => undefined));
  const persist = vi.fn(options.persist ?? (async () => undefined));
  const ensureReady = vi.fn(options.ensureReady ?? (async () => true));
  const onBatchTaken = vi.fn();
  const afterPersist = vi.fn(options.afterPersist ?? (async () => undefined));
  const nowValues = options.nowValues ?? [10, 25];
  const now = vi.fn(() => nowValues.shift() ?? 25);

  return {
    inflight,
    recordDuration,
    waitForCapacity,
    persist,
    ensureReady,
    onBatchTaken,
    afterPersist,
    executor: new IndexedWriteFlushExecutorService({
      buffer,
      getBatchSize: () => 2,
      isAvailable: options.isAvailable ?? (() => true),
      ensureReady,
      buildPersistEntries: (entries) =>
        entries.map((entry) => entry.toUpperCase()),
      persist,
      waitForCapacity,
      recordDuration,
      now,
      onBatchTaken,
      afterPersist,
      shouldRetainBatch: options.shouldRetainBatch,
      prepareBatch: options.prepareBatch,
      resolveBatchMetadata: (entries) => ({ firstEntry: entries[0] }),
      resolvePersistMetadata: (result) =>
        result && typeof result === "object"
          ? { persisted: result.persisted }
          : undefined,
    }),
  };
}

describe("IndexedWriteFlushExecutorService", () => {
  it("persists a batch and commits inflight entries", async () => {
    const pending = new Map<number, string>([
      [1, "one"],
      [2, "two"],
      [3, "three"],
    ]);
    const {
      executor,
      inflight,
      persist,
      waitForCapacity,
      recordDuration,
      onBatchTaken,
    } = createExecutor({ pending });

    const result = await executor.execute();

    expect(result).toEqual({
      status: "flushed",
      entries: 2,
      pending: 1,
      inflight: 0,
      reason: "persisted",
      metadata: { firstEntry: "one" },
      durationMs: 15,
    });
    expect(onBatchTaken).toHaveBeenCalledWith(["one", "two"]);
    expect(waitForCapacity).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(["ONE", "TWO"]);
    expect(recordDuration).toHaveBeenCalledWith(15);
    expect(pending.has(1)).toBe(false);
    expect(pending.has(2)).toBe(false);
    expect(pending.has(3)).toBe(true);
    expect(inflight.size).toBe(0);
  });

  it("merges persist result metadata into the flush result", async () => {
    const pending = new Map<number, string>([
      [1, "one"],
      [2, "two"],
    ]);
    const { executor } = createExecutor({
      pending,
      persist: async () => ({ persisted: 2 }),
    });

    await expect(executor.execute()).resolves.toMatchObject({
      status: "flushed",
      metadata: {
        firstEntry: "one",
        persisted: 2,
      },
    });
  });

  it("normalizes negative or malformed flush duration before recording evidence", async () => {
    const pending = new Map<number, string>([[1, "one"]]);
    const { executor, recordDuration } = createExecutor({
      pending,
      nowValues: [25, 10],
    });

    const result = await executor.execute();

    expect(result.durationMs).toBe(0);
    expect(recordDuration).toHaveBeenCalledWith(0);
  });

  it("rolls back the batch when readiness fails", async () => {
    const pending = new Map<number, string>([[1, "one"]]);
    const { executor, inflight, persist } = createExecutor({
      pending,
      ensureReady: async () => false,
    });

    await expect(executor.execute()).resolves.toMatchObject({
      status: "not-ready",
      entries: 1,
      pending: 1,
      inflight: 0,
      reason: "not-ready",
      metadata: { firstEntry: "one" },
    });
    expect(persist).not.toHaveBeenCalled();
    expect(pending.get(1)).toBe("one");
    expect(inflight.size).toBe(0);
  });

  it("rolls back the batch when persistence fails", async () => {
    const pending = new Map<number, string>([[1, "one"]]);
    const { executor, inflight } = createExecutor({
      pending,
      persist: async () => {
        throw new Error("persist failed");
      },
    });

    await expect(executor.execute()).rejects.toMatchObject({
      message: "persist failed",
      flushResult: {
        status: "idle",
        entries: 1,
        pending: 1,
        inflight: 0,
        reason: "persist-failed",
        error: "persist failed",
        metadata: { firstEntry: "one" },
      },
    });
    expect(pending.get(1)).toBe("one");
    expect(inflight.size).toBe(0);
  });

  it("publishes after local persistence and only commits the buffer after publish succeeds", async () => {
    const pending = new Map<number, string>([[1, "one"]]);
    const order: string[] = [];
    const publishGate = Promise.withResolvers<Record<string, unknown>>();
    const { executor, inflight } = createExecutor({
      pending,
      persist: async () => {
        order.push("persist");
        return { persisted: 1 };
      },
      afterPersist: async () => {
        order.push("publish");
        return await publishGate.promise;
      },
    });

    const flush = executor.execute();
    await vi.waitFor(() => expect(order).toEqual(["persist", "publish"]));

    expect(inflight.size).toBe(1);
    expect(pending.size).toBe(0);
    publishGate.resolve({ indexedItems: 1 });

    await expect(flush).resolves.toMatchObject({
      status: "flushed",
      metadata: { persisted: 1, indexedItems: 1 },
    });
    expect(inflight.size).toBe(0);
  });

  it("restores the batch when publish fails after local persistence", async () => {
    const pending = new Map<number, string>([[1, "one"]]);
    const { executor, inflight, persist } = createExecutor({
      pending,
      afterPersist: async () => {
        throw new Error("publish failed");
      },
    });

    await expect(executor.execute()).rejects.toMatchObject({
      message: "publish failed",
      flushResult: expect.objectContaining({
        reason: "persist-failed",
        pending: 1,
        inflight: 0,
      }),
    });
    expect(persist).toHaveBeenCalledWith(["ONE"]);
    expect(pending.get(1)).toBe("one");
    expect(inflight.size).toBe(0);
  });

  it("returns idle when dependencies are unavailable", async () => {
    const pending = new Map<number, string>([[1, "one"]]);
    const { executor, persist } = createExecutor({
      pending,
      isAvailable: () => false,
    });

    await expect(executor.execute()).resolves.toMatchObject({
      status: "idle",
      entries: 0,
      pending: 1,
      reason: "unavailable",
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("maps executor results to adapter-specific status and numeric metadata fields", () => {
    const result = mapIndexedWriteFlushExecutorResult(
      {
        status: "not-ready",
        entries: 2,
        pending: 2,
        inflight: 0,
        reason: "not-ready",
        metadata: {
          withContent: 1,
          textOnly: "ignored",
        },
      },
      {
        statusMap: {
          idle: "idle",
          flushed: "flushed",
          "not-ready": "worker-not-ready",
        },
        numericMetadataKeys: ["withContent", "missing"],
      },
    );

    expect(result).toMatchObject({
      status: "worker-not-ready",
      entries: 2,
      withContent: 1,
      missing: 0,
      metadata: {
        withContent: 1,
        textOnly: "ignored",
      },
    });
  });

  it("drops malformed numeric metadata while mapping executor results", () => {
    const result = mapIndexedWriteFlushExecutorResult(
      {
        status: "flushed",
        entries: 2,
        pending: 0,
        inflight: 0,
        metadata: {
          valid: 2,
          negative: -1,
          nan: Number.NaN,
          infinite: Number.POSITIVE_INFINITY,
        },
      },
      {
        numericMetadataKeys: [
          "valid",
          "negative",
          "nan",
          "infinite",
          "missing",
        ],
      },
    );

    expect(result).toMatchObject({
      status: "flushed",
      valid: 2,
      negative: 0,
      nan: 0,
      infinite: 0,
      missing: 0,
    });
  });

  it("builds numeric metadata from batch metrics", () => {
    const result = buildIndexedWriteFlushBatchMetrics(
      [{ content: "one" }, { content: "" }, { content: "three" }],
      [
        {
          key: "withContent",
          count: (entry) => entry.content.length > 0,
        },
        {
          key: "empty",
          count: (entry) => entry.content.length === 0,
        },
      ],
    );

    expect(result).toEqual({
      withContent: 2,
      empty: 1,
    });
  });
});

describe("IndexedWriteFlushExecutorService retained durable ownership", () => {
  it("resumes the exact persisted payload instead of repersisting or replacing it with newer pending work", async () => {
    const pending = new Map<number, string>([[1, "old"]]);
    const deferred = new Error("foreground-preempted");
    const published: string[][] = [];
    const inputs: Array<{ entries: string[]; persistEntries: string[]; result: { persisted: number } | void }> = [];
    let preempt = true;
    const { executor, inflight, persist } = createExecutor({
      pending,
      persist: async () => ({ persisted: 1 }),
      shouldRetainBatch: (error) => error === deferred,
      afterPersist: async (input) => {
        inputs.push(input);
        if (preempt) throw deferred;
        published.push(input.persistEntries);
        return { indexedItems: input.entries.length };
      },
    });
    await expect(executor.execute()).rejects.toBe(deferred);
    expect(pending.size).toBe(0);
    expect(inflight.get(1)).toBe("old");
    pending.set(1, "new");
    preempt = false;
    await expect(executor.execute()).resolves.toMatchObject({ status: "flushed", pending: 1, inflight: 0, metadata: { persisted: 1, indexedItems: 1 } });
    expect(inputs[1].entries).toBe(inputs[0].entries);
    expect(inputs[1].persistEntries).toBe(inputs[0].persistEntries);
    expect(inputs[1].result).toBe(inputs[0].result);
    expect(published).toEqual([["OLD"]]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(pending.get(1)).toBe("new");
    await executor.execute();
    expect(published).toEqual([["OLD"], ["NEW"]]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("retains a durable batch on genuine publication failure without losing its error contract", async () => {
    let fail = true;
    const published: string[] = [];
    const { executor, inflight, persist } = createExecutor({
      pending: new Map([[1, "one"]]),
      shouldRetainBatch: () => false,
      afterPersist: async ({ persistEntries }) => {
        if (fail) throw new Error("publication SQL failed");
        published.push(...persistEntries);
      },
    });
    await expect(executor.execute()).rejects.toMatchObject({ message: "publication SQL failed", flushResult: { entries: 1, pending: 0, inflight: 1, reason: "persist-failed" } });
    expect(inflight.get(1)).toBe("one");
    fail = false;
    await executor.execute();
    expect(published).toEqual(["ONE"]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(inflight.size).toBe(0);
  });

  it.each(["readiness", "capacity", "prepare", "persistence"] as const)(
    "discard invalidates an active %s continuation before any later publication", async (stage) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const durable: string[] = [];
      const published: string[] = [];
      const hold = async () => { entered.resolve(); await release.promise; };
      const { executor, inflight } = createExecutor({
        pending: new Map([[1, "one"]]),
        ensureReady: async () => { if (stage === "readiness") await hold(); return true; },
        prepareBatch: async () => { if (stage === "prepare") await hold(); return true; },
        waitForCapacity: async () => { if (stage === "capacity") await hold(); },
        persist: async (entries) => {
          if (stage === "persistence") await hold();
          durable.push(...entries);
        },
        afterPersist: async ({ persistEntries }) => { published.push(...persistEntries); },
      });
      const running = executor.execute();
      const rejected = expect(running).rejects.toThrow("INDEXED_WRITE_FLUSH_CANCELLED");
      await entered.promise;
      executor.discardRetainedBatch();
      release.resolve();
      await rejected;
      expect(published).toEqual([]);
      expect(durable).toEqual(stage === "persistence" ? ["ONE"] : []);
      expect(inflight.size).toBe(0);
      expect(executor.retainedEntries).toEqual([]);
    },
  );

  it("drops an invalidated retained batch without publishing its durable payload", async () => {
    let valid = true;
    const deferred = new Error("foreground-preempted");
    const published: string[] = [];
    const { executor, inflight, persist } = createExecutor({
      pending: new Map([[1, "one"]]),
      shouldRetainBatch: (error) => error === deferred,
      prepareBatch: async () => valid,
      afterPersist: async ({ persistEntries }) => {
        if (valid) throw deferred;
        published.push(...persistEntries);
      },
    });
    await expect(executor.execute()).rejects.toBe(deferred);
    valid = false;
    await expect(executor.execute()).resolves.toMatchObject({ status: "idle", reason: "invalidated-batch", inflight: 0 });
    expect(published).toEqual([]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(inflight.size).toBe(0);
  });
});
