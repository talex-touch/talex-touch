import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IndexedWriteFlushRuntimeService,
} from "../../search";

function createRuntime(options: {
  pendingSize?: () => number;
  inflightSize?: () => number;
  isAvailable?: () => boolean;
  hasWork?: () => boolean;
  handleDeferredFailure?: (error: unknown) => boolean;
  executeFlush?: () => Promise<{ status: string }>;
  resolveFailure?: () => {
    delayMs: number;
    nextRetryCount: number;
    reason: string;
  };
}) {
  const recordIdle = vi.fn();
  const resolveFailure = vi.fn(
    options.resolveFailure ??
      (() => ({
        delayMs: 25,
        nextRetryCount: 1,
        reason: "retry",
      })),
  );
  const handleFailure = vi.fn();
  const service = new IndexedWriteFlushRuntimeService({
    getPendingSize: options.pendingSize ?? (() => 1),
    getInflightSize: options.inflightSize ?? (() => 0),
    isAvailable: options.isAvailable ?? (() => true),
    hasWork: options.hasWork,
    handleDeferredFailure: options.handleDeferredFailure,
    executeFlush: options.executeFlush ?? (async () => ({ status: "flushed" })),
    recordIdle,
    getFlushDelay: () => 15,
    resolveFailure,
    handleFailure,
    config: {
      flushDeferMs: 10,
    },
  });

  return {
    handleFailure,
    recordIdle,
    resolveFailure,
    service,
  };
}

describe("IndexedWriteFlushRuntimeService", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records idle when dependencies are unavailable", async () => {
    const { recordIdle, service } = createRuntime({
      isAvailable: () => false,
      pendingSize: () => 2,
      inflightSize: () => 1,
    });

    await service.flush();

    expect(recordIdle).toHaveBeenCalledWith({
      reason: "unavailable",
      pending: 2,
      inflight: 1,
    });
  });

  it("records idle when there are no pending entries", async () => {
    const { recordIdle, service } = createRuntime({
      pendingSize: () => 0,
    });

    await service.flush();

    expect(recordIdle).toHaveBeenCalledWith({
      reason: "no-pending",
      pending: 0,
      inflight: 0,
    });
  });

  it("normalizes malformed pending and inflight sizes before recording idle", async () => {
    const executeFlush = vi.fn();
    const { recordIdle, service } = createRuntime({
      pendingSize: () => Number.NaN,
      inflightSize: () => Number.NEGATIVE_INFINITY,
      executeFlush,
    });

    await service.flush();

    expect(executeFlush).not.toHaveBeenCalled();
    expect(recordIdle).toHaveBeenCalledWith({
      reason: "no-pending",
      pending: 0,
      inflight: 0,
    });
  });

  it("serializes concurrent flush calls and schedules a deferred flush", async () => {
    vi.useFakeTimers();
    let releaseFlush!: () => void;
    const firstFlush = new Promise<{ status: string }>((resolve) => {
      releaseFlush = () => resolve({ status: "flushed" });
    });
    const executeFlush = vi.fn().mockImplementationOnce(() => firstFlush);
    const { recordIdle, service } = createRuntime({
      executeFlush,
    });

    const flush = service.flush();
    await Promise.resolve();
    await service.flush();

    expect(recordIdle).toHaveBeenCalledWith({
      reason: "flush-in-progress",
      pending: 1,
      inflight: 0,
    });
    expect(vi.getTimerCount()).toBe(1);

    releaseFlush();
    await flush;
  });

  it("schedules retry after failed flush", async () => {
    vi.useFakeTimers();
    const error = new Error("persist failed");
    const { handleFailure, resolveFailure, service } = createRuntime({
      executeFlush: async () => {
        throw error;
      },
      pendingSize: () => 3,
    });

    await service.flush();

    expect(resolveFailure).toHaveBeenCalledWith({
      error,
      pendingSize: 3,
      retryCount: 0,
    });
    expect(handleFailure).toHaveBeenCalledWith({
      error,
      decision: {
        delayMs: 25,
        nextRetryCount: 1,
        reason: "retry",
      },
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("normalizes malformed retry decisions before scheduling failure retry", async () => {
    vi.useFakeTimers();
    const error = new Error("persist failed");
    const { handleFailure, service } = createRuntime({
      executeFlush: async () => {
        throw error;
      },
      pendingSize: () => 3,
      resolveFailure: () => ({
        delayMs: Number.POSITIVE_INFINITY,
        nextRetryCount: -1,
        reason: "retry",
      }),
    });

    await service.flush();

    expect(handleFailure).toHaveBeenCalledWith({
      error,
      decision: {
        delayMs: 0,
        nextRetryCount: 0,
        reason: "retry",
      },
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("drains remaining pending entries after a successful flush", async () => {
    vi.useFakeTimers();
    let pending = 2;
    const { service } = createRuntime({
      pendingSize: () => pending,
      executeFlush: async () => {
        pending = 1;
        return { status: "flushed" };
      },
    });

    await service.flush();

    expect(vi.getTimerCount()).toBe(1);
  });

  it("supports result-specific rescheduling", async () => {
    vi.useFakeTimers();
    let pending = 1;
    const service = new IndexedWriteFlushRuntimeService({
      getPendingSize: () => pending,
      getInflightSize: () => 0,
      isAvailable: () => true,
      executeFlush: async () => {
        pending = 0;
        return { status: "not-ready" };
      },
      recordIdle: vi.fn(),
      getFlushDelay: () => 15,
      resolveFailure: vi.fn(),
      handleFailure: vi.fn(),
      shouldRescheduleAfterResult: (result) =>
        result.status === "not-ready"
          ? { delayMs: 100, reason: "not-ready" }
          : null,
    });

    await service.flush();

    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("IndexedWriteFlushRuntimeService lifecycle ownership", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not report or poll a foreground deferral as a persistence failure", async () => {
    vi.useFakeTimers();
    const lifecycle = new Error("foreground-preempted");
    let available = true;
    let attempts = 0;
    const { service, handleFailure, resolveFailure } = createRuntime({
      isAvailable: () => available,
      executeFlush: async () => { attempts += 1; throw lifecycle; },
      handleDeferredFailure: (error) => {
        if (error !== lifecycle) return false;
        available = false;
        return true;
      },
    });
    await service.flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toBe(1);
    expect(handleFailure).not.toHaveBeenCalled();
    expect(resolveFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    service.dispose();
  });

  it("flushes retained inflight work even when no pending entries remain", async () => {
    vi.useFakeTimers();
    let retained = true;
    const outputs: string[] = [];
    const { service } = createRuntime({
      pendingSize: () => 0,
      inflightSize: () => retained ? 1 : 0,
      hasWork: () => retained,
      executeFlush: async () => { outputs.push("durable payload published"); retained = false; return { status: "flushed" }; },
    });
    await service.flush();
    expect(outputs).toEqual(["durable payload published"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outputs).toEqual(["durable payload published"]);
    expect(vi.getTimerCount()).toBe(0);
    service.dispose();
  });
});
