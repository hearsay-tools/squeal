import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { readSlowEvidence, slowTokensMetaKey } from "../../src/core/slow/rank-store.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { waitFor } from "../watcher/helpers.js";
import { createRepo, type Harness, openHarness, openRepoStore, ref, SLOW } from "./helpers.js";

/*
 * Spec 004 D2 as amended 2026-10-18 (task 004-82) with the scheduler over
 * real Vitest runs: three slow files every `src/**` edit re-keys (declared
 * inputs, as cezarion's browser specs). `slow-c` is the longest and selects
 * `panel-body` through its `./` helper, so by duration it runs last and by
 * evidence first after an edit whose file offers that token.
 */

const A = "test/slow-a.test.ts";
const B = "test/slow-b.test.ts";
const C = "test/slow-c.test.ts";
const HELPER = "test/slow-helper.ts";
const PANEL = "src/panel.ts";

const slotDirs: string[] = [];
afterEach(() => {
  for (const dir of slotDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function policy(rank: Policy["slow"]["rank"]): Partial<Policy> {
  return {
    slow: { ...DEFAULT_POLICY.slow, include: ["test/slow-*.test.ts"], maxParallel: 1, rank },
    inputs: { "test/slow-*.test.ts": ["src/**"] },
  };
}

const spec = (name: string, ms: number, extra = "") =>
  `import { expect, it } from "vitest";\n${extra}it("${name}", async () => {\n  await new Promise((r) => setTimeout(r, ${ms}));\n  expect("[data-slot=\\"toolbar\\"]").toContain("toolbar");\n});\n`;

async function open(rank: Policy["slow"]["rank"]): Promise<Harness> {
  const repo = createRepo();
  // Before the harness opens, so the adapter lists them.
  const put = (path: string, content: string) => writeFileSync(join(repo.main, path), content);
  put(A, spec("a", 5));
  put(B, spec("b", 5));
  put(HELPER, `export const panel = (page: string) => \`\${page} .panel-body\`;\n`);
  put(C, spec("c", 400, `import { panel } from "./slow-helper";\npanel("page");\n`));
  put(PANEL, `export const panel = 'data-slot="panel-body"';\n`);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-82-slot-"));
  slotDirs.push(slotDir);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    tierSize: 4,
    policy: { ...RUN_MISSING, ...policy(rank) },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  });
  await h.scheduler.start();
  await waitFor(() => slowOrder(h, 0).length >= 3, 60_000);
  await h.scheduler.idle();
  return h;
}

/** The slow files the runs after `start` ran, in order. */
const slowOrder = (h: Harness, start: number) =>
  h.runner.runs
    .slice(start)
    .flatMap((run) => run.files.map((f) => f.path))
    .filter((path) => [A, B, C].includes(path));

/** Edits `path` and waits until `expected` slow files ran after it. */
async function edit(h: Harness, path: string, content: string, expected = 3): Promise<string[]> {
  const start = h.runner.runs.length;
  h.write(path, content);
  await h.batch(path);
  await waitFor(() => slowOrder(h, start).length >= expected, 60_000);
  await h.scheduler.idle();
  return slowOrder(h, start);
}

describe("slow files ranked by evidence (spec 004 D2, task 004-82)", SLOW, () => {
  it("runs the slow file whose helper selects the edit's token first, and every slow file still runs", async () => {
    const h = await open("tokens");
    const order = await edit(
      h,
      PANEL,
      `export const panel = 'data-slot="panel-body"'; // edited\n`,
    );
    expect(order[0]).toBe(C);
    expect([...order].sort()).toEqual([A, B, C]);
    // `why` reads the tokens at the key the file was queued for.
    const ranked = readSlowEvidence(h.store, h.worktreeId).get(testFileId(ref(C)));
    expect(ranked?.tokens).toEqual(["panel-body"]);
    expect(ranked?.key).toBe(h.keyOf(C));
  });

  it('keeps the duration order under slow.rank "duration"', async () => {
    const h = await open("duration");
    const order = await edit(
      h,
      PANEL,
      `export const panel = 'data-slot="panel-body"'; // edited\n`,
    );
    expect(order.at(-1)).toBe(C);
    expect([...order].sort()).toEqual([A, B, C]);
    expect(readSlowEvidence(h.store, h.worktreeId).size).toBe(0);
  });

  it("rebuilds a helper's token set when its hash changes", async () => {
    const h = await open("tokens");
    expect(await edit(h, PANEL, `export const panel = 'data-slot="panel-body"'; // 1\n`)).toEqual([
      C,
      expect.any(String),
      expect.any(String),
    ]);
    const before = h.store.meta.get(slowTokensMetaKey(HELPER));
    expect(before).toContain("panel-body");
    await edit(h, HELPER, `export const panel = (page: string) => \`\${page} .sidebar-nav\`;\n`, 1);
    const after = h.store.meta.get(slowTokensMetaKey(HELPER));
    expect(after).not.toContain("panel-body");
    const order = await edit(h, PANEL, `export const panel = 'data-slot="panel-body"'; // 2\n`);
    expect(order.at(-1)).toBe(C);
  });
});
