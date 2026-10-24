import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bundle } from "./bundle.js";
import { comparisons, REMOVAL } from "./self-test.js";

/*
 * Row 011-179, reviews w31b and w31b-r2, B1: a test that times out stops
 * waiting for its comparison, not the comparison, and it runs on to its next
 * one once the first ends. The file's last hook waits for every comparison it
 * accepted and refuses one that starts after it began, so each driver keeps
 * its paths until it ends and the work directory is gone after the hook. A
 * comparison is one real driver through `launch` that holds past a scaled
 * deadline; the release's setup is a directory.
 */

const held = vi.hoisted(() => ({
  /** Each driver's outputs once it ends, by its work directory: whether its paths were there then. */
  drivers: new Map<string, Promise<Record<string, unknown>>[]>(),
}));

vi.mock("./trees.js", async (importOriginal) => {
  const { mkdirSync } = await import("node:fs");
  return {
    ...(await importOriginal<typeof import("./trees.js")>()),
    lastRelease: () => "squeal--v0.0.0",
    extractTree: (_ref: string, into: string) => mkdirSync(into, { recursive: true }),
  };
});

vi.mock("./compare.js", async () => {
  const { dirname } = await import("node:path");
  const { launch, prepare } = await import("./sides.js");
  // Holds past the test's deadline, then writes scratch and its outputs as a run's case does.
  const driver = `
    import { existsSync, mkdirSync, writeFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    const [, script, , cases, outFile, scratch] = process.argv;
    setTimeout(() => {
      const present = [script, cases, dirname(outFile)].every((path) => existsSync(path));
      mkdirSync(join(scratch, "0"), { recursive: true });
      writeFileSync(outFile, JSON.stringify({ present }));
    }, 2_000);
  `;
  return {
    compareTrees: async ({ work }: { work: string }) => {
      const side = prepare(work, "candidate", work, { text: driver } as Bundle, new Map());
      const output = launch(work, side, "run", [], "");
      const drivers = held.drivers.get(dirname(work)) ?? [];
      held.drivers.set(dirname(work), [...drivers, output]);
      await output;
      return {};
    },
  };
});

interface Watch {
  /** The work directory `comparisons()` made. */
  parent: string;
  /** The comparison the test starts once its first has ended, past its deadline. */
  next?: Promise<unknown>;
}

/**
 * Registers a hook before `comparisons()`, so it runs after that one's last
 * hook (`sequence.hooks` is `stack`): it waits for every driver, removes the
 * fixture, then checks each driver's paths, the work directory and how the
 * test's next comparison ended.
 */
function watched(): Watch {
  const watch: Watch = { parent: "" };
  afterAll(async () => {
    const drivers = held.drivers.get(watch.parent) ?? [];
    expect(drivers, "the comparison launched no driver").not.toHaveLength(0);
    const outputs = await Promise.all(
      drivers.map((output) => output.catch((error: unknown) => ({ failed: String(error) }))),
    );
    const next = await watch.next?.then(
      () => "ran",
      (error: unknown) => String(error),
    );
    const left = existsSync(watch.parent);
    await rm(watch.parent, { recursive: true, force: true, maxRetries: 3 });
    expect(outputs, "the hook removed a driver's paths while it ran").toEqual(
      drivers.map(() => ({ present: true })),
    );
    expect(left, "the work directory is left after the file's last hook").toBe(false);
    if (watch.next !== undefined) {
      expect(next, "the hook let a comparison start after it began").toMatch(/does not run/);
    }
  }, REMOVAL.timeout);
  return watch;
}

describe("one comparison", () => {
  const watch = watched();
  const { compare, tree } = comparisons();

  it.fails("times out while its comparison's driver runs", async () => {
    watch.parent = dirname(tree());
    await compare({});
  }, 100);
});

describe("two comparisons in sequence", () => {
  const watch = watched();
  const { compare, tree } = comparisons();

  it.fails("times out while its first comparison's driver runs, then starts its second", async () => {
    watch.parent = dirname(tree());
    await compare({});
    watch.next = compare({});
    await watch.next;
  }, 100);
});
