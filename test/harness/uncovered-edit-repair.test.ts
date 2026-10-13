import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import { readAll, slot } from "../../src/core/delivery/slots.js";
import { uncoveredMetaKey } from "../../src/core/delivery/uncovered.js";
import {
  CONSUMER_EXPIRY_MS,
  type TestFileRef,
  worktreeMetaKey,
} from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { fitUncovered, UNCOVERED_LINE_CAP_CHARS } from "../../src/harness/shared/uncovered-edit.js";
import { check } from "../state/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-314, the repair of review wave 13as (001-313): its three probes,
 * B1 a shared test file's closure written by another worktree, B2 a session
 * that ends and comes back, B3 paths too long for the cap.
 */

const alive: HookDeps = { env: {}, ensureDaemon: async () => "alive" };
const OTHER_SESSION = "0b6c1f7e-3f43-4d2a-9a51-2c1b0e5a7d90";

const context = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

const told = (paths: string, it = "it") =>
  `No result for ${paths}: no test Squeal runs reads ${it}. Run whatever tests ${it} yourself.`;

/** `FILE` listed at `k1` with `paths` as this worktree's closure; passing; the main session registered. */
async function repo(paths = ["src/math.test.ts", "src/math.ts"]): Promise<SquealRepo> {
  const r = squealRepo();
  closure(r, r.worktreeId, paths);
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), alive);
  return r;
}

function closure(r: SquealRepo, by: string, paths: string[], testFile: TestFileRef = FILE): void {
  r.store.testFiles.put({
    testFile,
    closure: { testFile, paths, complete: false, method: "static imports plus declared inputs" },
    updatedAt: 1,
    updatedBy: by,
  });
}

/** Worktree B listing `FILE` at `key` and writing its closure `paths`, newest wins (`storeClosures`). */
function otherWorktree(r: SquealRepo, key: string, paths: string[]): void {
  const b = r.repo.addWorktree("b");
  r.store.worktrees.upsert({
    id: b.id,
    root: b.root,
    commonDir: r.repo.commonDir,
    isMain: false,
    registeredAt: 1,
    daemon: null,
  });
  r.store.testFileKeys.upsertMany([
    { worktreeId: b.id, testFile: FILE, key, revision: 1, pending: null },
  ]);
  closure(r, b.id, paths);
}

/** A revision changing `paths`, each written on disk. */
function edit(r: SquealRepo, paths: string[]): void {
  for (const path of paths) {
    mkdirSync(dirname(join(r.root, path)), { recursive: true });
    writeFileSync(join(r.root, path), "export {};\n");
  }
  r.store.transaction(() =>
    r.store.revisions.append({
      worktreeId: r.worktreeId,
      createdAt: 2,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: paths.map((path, i) => ({ path, oldHash: null, newHash: `h${i}-${Math.random()}` })),
    }),
  );
}

async function hook(
  r: SquealRepo,
  name: "session-start" | "post-tool-batch" | "session-end",
  session?: string,
  deps = alive,
): Promise<string> {
  const overrides = session === undefined ? {} : { session_id: session };
  return context(await runHook(name, recorded(name, r.root, overrides), deps));
}

const toldRow = (r: SquealRepo) => readAll(r.store, uncoveredMetaKey(r.worktreeId));
const parkedRow = (r: SquealRepo) =>
  readAll(r.store, worktreeMetaKey("registeredLeft", r.worktreeId));

describe("B1: a shared test file's closure counts only under D6's trust rule", () => {
  it("is not warned about by another worktree's closure at another key that drops the path", async () => {
    // FOREIGN_CLOSURE: this worktree's test reads the script; B's newer version does not.
    const r = await repo(["src/math.test.ts", "scripts/a.mjs"]);
    otherWorktree(r, "k2", ["src/math.test.ts"]);
    edit(r, ["scripts/a.mjs"]);
    expect(await hook(r, "post-tool-batch")).toBe("");
    expect(toldRow(r)).toEqual({});
  });

  it("is not kept quiet by another worktree's closure at another key, and warns from its own", async () => {
    // FOREIGN_SUPPRESSES: B's test reads the script, this worktree's does not.
    const r = await repo();
    otherWorktree(r, "k2", ["src/math.test.ts", "scripts/a.mjs"]);
    edit(r, ["scripts/a.mjs"]);
    expect(await hook(r, "post-tool-batch")).toBe("");
    expect(toldRow(r)).toEqual({});
    // LOCAL_CLOSURE_CONTROL: this worktree writes its closure again.
    closure(r, r.worktreeId, ["src/math.test.ts", "src/math.ts"]);
    expect(await hook(r, "post-tool-batch")).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);
  });

  it("trusts another worktree's closure at this worktree's key", async () => {
    const r = await repo(["src/math.test.ts", "scripts/a.mjs"]);
    otherWorktree(r, "k1", ["src/math.test.ts", "scripts/b.mjs"]);
    edit(r, ["scripts/a.mjs", "scripts/b.mjs"]);
    expect(await hook(r, "post-tool-batch")).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);
  });
});

describe("B2: a session told a path and back before its expiry is not told it again", () => {
  it("keeps the told set while parked, through another session's write", async () => {
    const r = await repo();
    edit(r, ["scripts/a.mjs"]);
    // FIRST_TOLD
    expect(await hook(r, "post-tool-batch")).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);
    await hook(r, "session-end");

    await hook(r, "session-start", OTHER_SESSION);
    edit(r, ["scripts/b.mjs"]);
    expect(await hook(r, "post-tool-batch", OTHER_SESSION)).toBe(
      `SQUEAL · ${told("scripts/b.mjs")}`,
    );

    // RESUMED_WITHOUT_EDIT: silent; and the path stays told after another edit.
    await hook(r, "session-start");
    expect(await hook(r, "post-tool-batch")).toBe("");
    edit(r, ["scripts/a.mjs"]);
    expect(await hook(r, "post-tool-batch")).toBe("");
    expect(toldRow(r)[slot(r.consumer())]).toEqual(["scripts/a.mjs"]);
  });

  it("forgets the told set with the parked registration at its expiry", async () => {
    const r = await repo();
    edit(r, ["scripts/a.mjs"]);
    expect(await hook(r, "post-tool-batch")).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);
    const left = Date.now() - CONSUMER_EXPIRY_MS - 1;
    await hook(r, "session-end", undefined, { ...alive, now: () => left });
    expect(toldRow(r)[slot(r.consumer())]).toBeUndefined();
    expect(parkedRow(r)[slot(r.consumer())]).toMatchObject({ uncovered: ["scripts/a.mjs"] });

    await hook(r, "session-start");
    expect(parkedRow(r)[slot(r.consumer())]).toBeUndefined();
    expect(toldRow(r)[slot(r.consumer())]).toBeUndefined();
    edit(r, ["scripts/a.mjs"]);
    expect(await hook(r, "post-tool-batch")).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);
  });
});

/** The review's path: 18 directories of 194 or 195 characters, then `a.mjs`; 3,523 characters. */
const longPath = (i: number) =>
  `${Array.from({ length: 18 }, (_, j) => `${i}-${j}-${"d".repeat(190)}`).join("/")}/a.mjs`;

describe("B3: the line fits inside the delivery cap", () => {
  it("names three 3,523-character paths within its cap, with no delta", async () => {
    const r = await repo();
    const paths = [0, 1, 2].map(longPath);
    expect(paths.map((p) => p.length)).toEqual([3523, 3523, 3523]);
    edit(r, paths);
    const text = await hook(r, "post-tool-batch");
    expect(text.length).toBeLessThanOrEqual(UNCOVERED_LINE_CAP_CHARS);
    expect(text).toMatch(/^SQUEAL · No result for …\S+\/a\.mjs and 2 more: no test Squeal runs/);
    expect(text.endsWith("Run whatever tests them yourself.")).toBe(true);
    expect(toldRow(r)[slot(r.consumer())]).toEqual(paths);
  });

  it("keeps the whole message within 10,000 characters beside failures", async () => {
    const r = await repo();
    const failing = Array.from({ length: 200 }, (_, i) =>
      r.fail(check(`math > case ${i}`, FILE), "x".repeat(300)),
    );
    edit(r, [0, 1, 2].map(longPath));
    r.apply(...failing);
    const text = await hook(r, "post-tool-batch");
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(text).toMatch(/^SQUEAL · 200 checks changed at revision 3\n/);
    expect(text).toMatch(/\nNo result for …\S+ and 2 more: no test Squeal runs reads them\./);
  });

  it("names fewer paths when three do not fit, and counts the rest", () => {
    const paths = ["a", "b", "c"].map((n) => `${n.repeat(400)}.ts`);
    expect(fitUncovered(paths)).toBe(told(`${paths[0]}, ${paths[1]} and 1 more`, "them"));
    expect(fitUncovered(["a.ts", "b.ts", "c.ts", "d.ts"])).toBe(
      told("a.ts, b.ts, c.ts and 1 more", "them"),
    );
  });
});
