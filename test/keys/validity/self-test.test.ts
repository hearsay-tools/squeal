import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type { Bundle } from "./bundle.js";
import { comparisons, REMOVAL } from "./self-test.js";

/*
 * Row 011-179, review w31b B1: a test that times out stops waiting for its
 * comparison, not the comparison. The file's last hook waits for it, so a
 * driver still running past the test's deadline keeps its directory until
 * it ends, and the work directory is gone after the hook. The comparison is
 * one real driver through `launch` that holds past a scaled deadline; the
 * release's setup is a directory.
 */

const held = vi.hoisted(() => ({
  /** The driver's outputs once it ends: whether its directory was there then. */
  output: undefined as Promise<Record<string, unknown>> | undefined,
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
  const { launch, prepare } = await import("./sides.js");
  // Holds past the test's deadline, then writes scratch and its outputs as a run's case does.
  const driver = `
    import { existsSync, mkdirSync, writeFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    const [, , , , outFile, scratch] = process.argv;
    setTimeout(() => {
      const present = existsSync(dirname(outFile));
      mkdirSync(join(scratch, "0"), { recursive: true });
      writeFileSync(outFile, JSON.stringify({ present }));
    }, 1_000);
  `;
  return {
    compareTrees: async ({ work }: { work: string }) => {
      const side = prepare(work, "candidate", work, { text: driver } as Bundle, new Map());
      held.output = launch(work, side, "run", [], "");
      await held.output;
      return {};
    },
  };
});

/** The work directory `comparisons()` made. */
let parent = "";

// Registered before `comparisons()`, so it runs after that file's last hook.
afterAll(async () => {
  expect(held.output, "the comparison launched no driver").toBeDefined();
  const output = await held.output;
  const left = existsSync(parent);
  await rm(parent, { recursive: true, force: true, maxRetries: 3 });
  expect(output, "the hook removed the driver's directory while it ran").toEqual({ present: true });
  expect(left, "the work directory is left after the file's last hook").toBe(false);
}, REMOVAL.timeout);

const { compare, tree } = comparisons();

it.fails("times out while its comparison's driver runs", async () => {
  parent = dirname(tree());
  await compare({});
}, 100);
