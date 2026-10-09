import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import type { AbsolutePath } from "../../../src/core/types/index.js";
import { Gate } from "../../../src/runners/vitest/gate.js";
import { relatedSpecifications } from "../../../src/runners/vitest/related.js";

/* Task 001-150: what the Vitest adapter's calls exclude (D5 as amended). */

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("vitest adapter: Gate (001-150)", () => {
  it("overlaps a run with the runner part, and queues each lane", async () => {
    const gate = new Gate();
    const held = deferred();
    const order: string[] = [];
    const run = gate.run(async () => {
      order.push("run");
      await held.promise;
      order.push("run end");
    });
    const parts = [1, 2].map((n) =>
      gate.part(async () => {
        order.push(`part ${n}`);
        await tick();
        order.push(`part ${n} end`);
      }),
    );
    const second = gate.run(async () => {
      order.push("run 2");
    });
    await Promise.all(parts);
    expect(order).toEqual(["run", "part 1", "part 1 end", "part 2", "part 2 end"]);
    held.resolve();
    await Promise.all([run, second]);
    expect(order.slice(5)).toEqual(["run end", "run 2"]);
  });

  it("starts a section after the call in flight and holds both lanes until it returns", async () => {
    const gate = new Gate();
    const held = deferred();
    const order: string[] = [];
    const run = gate.run(async () => {
      await held.promise;
      order.push("run end");
    });
    await tick();
    const part = gate.part((hold) =>
      hold.exclusive(async () => {
        order.push("section");
        await tick();
        order.push("section end");
      }),
    );
    await tick();
    const next = gate.run(async () => {
      order.push("next run");
    });
    const after = gate.part(async () => {
      order.push("next part");
    });
    await tick();
    expect(order).toEqual([]);
    held.resolve();
    await Promise.all([run, part, next, after]);
    expect(order.slice(0, 3)).toEqual(["run end", "section", "section end"]);
    expect(order.slice(3).sort()).toEqual(["next part", "next run"]);
  });

  it("queues two lanes asking for a section at once instead of waiting on each other", async () => {
    const gate = new Gate();
    const order: string[] = [];
    const both = await Promise.all([
      gate.run((hold) => hold.exclusive(async () => order.push("run section"))),
      gate.part((hold) => hold.exclusive(async () => order.push("part section"))),
    ]);
    expect(both).toHaveLength(2);
    expect(order).toEqual(["run section", "part section"]);
  });
});

describe("vitest adapter: the related walk beside a run (001-150)", () => {
  it("rejects when a run ending during the walk reset config.related", async () => {
    const config: { related?: string[] } = {};
    const vitest = {
      config,
      // As Vitest's `runFiles` does in its `finally`, while the walk awaits its glob.
      getRelevantTestSpecifications: async () => {
        delete config.related;
        return ["every spec"];
      },
    } as unknown as Vitest;
    await expect(relatedSpecifications(vitest, ["/w/src/a.ts" as AbsolutePath])).rejects.toThrow(
      "a run ended during the related walk",
    );
  });

  it("answers and clears config.related when no run ended", async () => {
    const config: { related?: string[] } = {};
    const seen: (string[] | undefined)[] = [];
    const vitest = {
      config,
      getRelevantTestSpecifications: async () => {
        seen.push(config.related);
        return ["one spec"];
      },
    } as unknown as Vitest;
    expect(await relatedSpecifications(vitest, ["/w/src/a.ts" as AbsolutePath])).toEqual([
      "one spec",
    ]);
    expect(seen).toEqual([["/w/src/a.ts"]]);
    expect("related" in config).toBe(false);
  });
});
