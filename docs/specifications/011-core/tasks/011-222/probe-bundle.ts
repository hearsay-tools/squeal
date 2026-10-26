// Row 011-222 probe: bundles the driver and each component's entries against
// a tag's tree with this worktree's harness, and names which pre-move
// fallbacks the bundle read. Usage: node --import tsx probe-bundle.ts <worktree> <tag>...
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [worktree, ...tags] = process.argv.slice(2);
const v = join(worktree, "test/keys/validity");
const { bundleDriver, bundleEntries } = await import(join(v, "bundle.ts"));
const { COMPONENTS } = await import(join(v, "components.ts"));
const { extractTree } = await import(join(v, "trees.ts"));

const FALLBACKS = [
  "harness/accept-rule-ledger.ts",
  "harness/store-traced.ts",
  "harness/barrier-scheduler.ts",
  "src/core/scheduler/ledger.ts",
  "src/core/scheduler/tiers.ts",
];

for (const tag of tags) {
  const work = mkdtempSync(join(tmpdir(), "squeal-011-222-"));
  try {
    const tree = join(work, "tree");
    extractTree(tag, tree);
    const targets = [
      ["driver", () => bundleDriver(tree, join(work, "driver.mjs"))],
      ...COMPONENTS.map((c: { name: string; entries: string }) => [
        `entries ${c.name}`,
        () => bundleEntries(tree, c.entries),
      ]),
    ] as const;
    for (const [name, make] of targets) {
      try {
        const b = await make();
        const read = FALLBACKS.filter((f) => b.map.sources.some((s: string) => s.endsWith(f)));
        const sha = createHash("sha256").update(b.text).digest("hex").slice(0, 16);
        console.log(`${tag}\t${name}\tok\t${sha}\tfallbacks read: ${read.length === 0 ? "none" : read.join(", ")}`);
      } catch (e) {
        const msg = String((e as Error).message).split("\n").slice(0, 3).join(" | ");
        console.log(`${tag}\t${name}\tFAILS\t${msg.slice(0, 300)}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
