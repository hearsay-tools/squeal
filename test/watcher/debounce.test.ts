import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Debouncer } from "../../src/core/watcher/debounce.js";

describe("Debouncer", () => {
  let flushed: string[][];
  let debouncer: Debouncer<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    debouncer = new Debouncer<string>((items) => flushed.push(items), {
      quietMs: 100,
      maxBatchMs: 500,
    });
  });

  afterEach(() => {
    debouncer.cancel();
    vi.useRealTimers();
  });

  it("flushes after 100 ms of quiet", () => {
    debouncer.push(["a"]);
    vi.advanceTimersByTime(99);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([["a"]]);
  });

  it("restarts the quiet window on every push", () => {
    debouncer.push(["a"]);
    vi.advanceTimersByTime(80);
    debouncer.push(["b"]);
    vi.advanceTimersByTime(80);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(flushed).toEqual([["a", "b"]]);
  });

  it("flushes at 500 ms even while events keep arriving", () => {
    for (let t = 0; t < 500; t += 50) {
      debouncer.push([`p${t}`]);
      vi.advanceTimersByTime(50);
    }
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(10);
  });

  it("starts a new batch after a flush", () => {
    debouncer.push(["a"]);
    vi.advanceTimersByTime(100);
    debouncer.push(["b"]);
    vi.advanceTimersByTime(100);
    expect(flushed).toEqual([["a"], ["b"]]);
  });

  it("reports whether a batch is pending and drops it on cancel", () => {
    expect(debouncer.pending).toBe(false);
    debouncer.push(["a"]);
    expect(debouncer.pending).toBe(true);
    debouncer.cancel();
    expect(debouncer.pending).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(flushed).toEqual([]);
  });

  it("ignores an empty push", () => {
    debouncer.push([]);
    expect(debouncer.pending).toBe(false);
  });
});
