import { afterEach, describe, expect, it, vi } from "vitest";
import { BusyResume } from "../../src/core/scheduler/busy-resume.js";
import { BusyWaits } from "../../src/core/store/index.js";

/*
 * Row 011-126: a tier's record that gave up on a busy store waits in
 * `BusyResume` for its turn, with the run's results kept, instead of
 * queuing the tier's files again. One try per resume, so the slices of
 * several records never add up in one tick.
 */

afterEach(() => {
  vi.useRealTimers();
});

function resumeWith(): { busy: BusyResume; notes: string[]; resumes: () => number } {
  const notes: string[] = [];
  let resumes = 0;
  const waits = new BusyWaits({ now: Date.now, note: (text) => notes.push(text) });
  const busy = new BusyResume(waits, () => {
    resumes++;
  });
  return { busy, notes, resumes: () => resumes };
}

describe("BusyResume's waiting records (011-126)", () => {
  it("gives a resume to the oldest record, the next when it lands, and the pump once none waits", async () => {
    vi.useFakeTimers();
    const { busy, notes, resumes } = resumeWith();
    const turns: string[] = [];
    void busy.retry("the results of 1 file").then(() => turns.push("a"));
    void busy.retry("the results of 2 files").then(() => turns.push("b"));
    busy.gaveUp("the next tier");

    await vi.advanceTimersByTimeAsync(0);
    expect(turns).toEqual(["a"]);
    busy.landed();
    await vi.advanceTimersByTimeAsync(0);
    expect(turns).toEqual(["a", "b"]);
    expect(resumes()).toBe(0);
    busy.landed();
    expect(resumes()).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(
      /ran once it was free: the results of 1 file, the results of 2 files, the next tier$/,
    );
  });

  it("keeps a waiting record's turn when another error abandons the pump's wait", async () => {
    vi.useFakeTimers();
    const { busy, notes, resumes } = resumeWith();
    const turns: string[] = [];
    void busy.retry("the results of 1 file").then(() => turns.push("a"));
    busy.gaveUp("the next tier");
    busy.abandon();

    await vi.advanceTimersByTimeAsync(250);
    expect(turns).toEqual(["a"]);
    busy.landed();
    // The pump that another error stopped does not resume, and its wait is no news.
    expect(resumes()).toBe(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/ran once it was free: the results of 1 file$/);
  });

  it("gives every waiting record its last try at the close", async () => {
    vi.useFakeTimers();
    const { busy } = resumeWith();
    const turns: string[] = [];
    void busy.retry("the results of 1 file").then(() => turns.push("a"));
    void busy.retry("the results of 2 files").then(() => turns.push("b"));
    busy.close();
    await Promise.resolve();
    expect(turns).toEqual(["a", "b"]);
    expect(busy.pending).toBe(false);
  });
});
