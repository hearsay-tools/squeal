import { describe, expect, it } from "vitest";
import { RUN_MISSING } from "../helpers/baseline.js";
import { CrossingClock, virtualClock } from "../helpers/virtual-clock.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";

/*
 * Row 011-353: what the model test (`model-fixture.ts`) and the harnesses'
 * `clock: "virtual"` stand on: a prompt virtual clock fires what is due once
 * the host turns, a jump passes timers without firing them inside the
 * reading, and a side on the virtual clock settles with `rest()`.
 */

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("the virtual clock of the model test and the harnesses (row 011-353)", () => {
  it("a prompt clock fires a timer due at its arm once the host turns, and time stands", async () => {
    const clock = virtualClock(1_000, { prompt: true });
    const fired: number[] = [];
    clock.arm(0, () => fired.push(clock.now()));
    clock.arm(5, () => fired.push(clock.now()));
    expect(fired).toEqual([]);
    await turn();
    expect(fired).toEqual([1_000]);
    expect(clock.now()).toBe(1_000);
    expect(clock.armed).toBe(1);
  });

  it("a jump moves the reading, fires nothing inside it, and the passed timers fire in order at the jumped time", async () => {
    const clock = virtualClock(0, { prompt: true });
    const fired: [string, number][] = [];
    clock.arm(20, () => fired.push(["b", clock.now()]));
    clock.arm(10, () => fired.push(["a", clock.now()]));
    clock.jump(30);
    expect(clock.now()).toBe(30);
    expect(fired).toEqual([]);
    await turn();
    expect(fired).toEqual([
      ["a", 30],
      ["b", 30],
    ]);
  });

  it("a clock without prompt fires only on advance", async () => {
    const clock = virtualClock(0);
    const fired: number[] = [];
    clock.arm(0, () => fired.push(clock.now()));
    clock.jump(5);
    await turn();
    expect(fired).toEqual([]);
    clock.advance(0);
    expect(fired).toEqual([5]);
  });

  it("a crossing clock jumps after its count of readings, once, and `raw` does not count", () => {
    const clock = new CrossingClock();
    const start = clock.raw();
    clock.cross(1, 60_000);
    expect(clock.now()).toBe(start);
    expect(clock.raw()).toBe(start);
    expect(clock.crossed).toBe(false);
    expect(clock.now()).toBe(start + 60_000);
    expect(clock.crossed).toBe(true);
    expect(clock.now()).toBe(start + 60_000);
    clock.cross(0, 1_000);
    clock.uncross();
    expect(clock.now()).toBe(start + 60_000);
  });

  it('a catch-up side with clock: "virtual" reads the virtual clock and rests after its baseline', async () => {
    const files = [{ path: "test/a.test.ts", ms: 1, imports: ["src/a.ts"] }];
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 2,
      policy: RUN_MISSING,
      clock: "virtual",
    });
    expect(side.clock).not.toBeNull();
    const start = side.now();
    await side.scheduler.start();
    await side.scheduler.idle();
    const rest = await side.rest();
    expect(rest.busyResume).toBe(false);
    expect(side.now()).toBe(start);
    expect(side.current("test/a.test.ts")).toBe(true);
    side.advance(1_000);
    expect(side.clock?.now()).toBe(start + 1_000);
  });
});
