import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import { uncoveredMetaKey } from "../../src/core/delivery/uncovered.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { type HookDeps, type HookResult, runHook } from "../../src/harness/claude-code/index.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { check } from "../state/helpers.js";
import { codexRecorded, sessionOf } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-292 (spec 001 D9, D11 as amended): after an edit, one line names
 * the changed code files no test Squeal runs reads, once per file per
 * consumer, worded as the eval measured it.
 */

const alive: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

const context = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

const told = (paths: string, it = "it") =>
  `No result for ${paths}: no test Squeal runs reads ${it}. Run whatever tests ${it} yourself.`;

/** `FILE` listed with its closure, `src/math.ts`; passing at revision 1; the main session registered. */
async function repo(): Promise<SquealRepo> {
  const r = squealRepo();
  closure(r, FILE, ["src/math.test.ts", "src/math.ts"]);
  r.apply(r.pass());
  await runHook("session-start", recorded("session-start", r.root), alive);
  return r;
}

function closure(r: SquealRepo, testFile: TestFileRef, paths: string[]): void {
  r.store.testFiles.put({
    testFile,
    closure: { testFile, paths, complete: false, method: "static imports plus declared inputs" },
    updatedAt: 1,
    updatedBy: r.worktreeId,
  });
}

/** A revision changing `paths`, each written on disk unless `deleted`. */
function edit(r: SquealRepo, paths: string[], deleted: string[] = []): void {
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
      changes: [...paths, ...deleted].map((path, i) => ({
        path,
        oldHash: null,
        newHash: deleted.includes(path) ? null : `h${i}-${Math.random()}`,
      })),
    }),
  );
}

async function boundary(r: SquealRepo, deps = alive, name = "post-tool-batch"): Promise<string> {
  return context(await runHook("post-tool-batch", recorded(name, r.root), deps));
}

describe("an edit to a code file no Squeal test reads (task 001-292)", () => {
  it("names an uncovered .mjs once, and nothing at its next edit", async () => {
    const r = await repo();
    edit(r, ["scripts/changelog.mjs"]);
    expect(await boundary(r)).toBe(`SQUEAL · ${told("scripts/changelog.mjs")}`);
    edit(r, ["scripts/changelog.mjs"]);
    expect(await boundary(r)).toBe("");
  });

  it("names nothing for a covered file, a .md, a dist/ file or a deleted file", async () => {
    const r = await repo();
    edit(
      r,
      ["src/math.ts", "src/math.test.ts", "README.md", "dist/a.js", "pkg/dist/b.mjs"],
      ["scripts/gone.ts"],
    );
    expect(await boundary(r)).toBe("");
    expect(r.store.meta.get(uncoveredMetaKey(r.worktreeId))).toBeNull();
  });

  it("shows the first 3 of four files and how many more", async () => {
    const r = await repo();
    edit(r, ["a.ts", "b.py", "c.cjs", "d.tsx"]);
    expect(await boundary(r)).toBe(`SQUEAL · ${told("a.ts, b.py, c.cjs and 1 more", "them")}`);
  });

  it("tells a second agent of the same session on its own", async () => {
    const r = await repo();
    // Its first boundary registers it (spec 001 D9).
    await boundary(r, alive, "subagent-post-tool-batch");
    edit(r, ["scripts/a.mjs"]);
    expect(await boundary(r)).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);
    expect(await boundary(r)).toBe("");
    expect(await boundary(r, alive, "subagent-post-tool-batch")).toBe(
      `SQUEAL · ${told("scripts/a.mjs")}`,
    );
    expect(await boundary(r, alive, "subagent-post-tool-batch")).toBe("");
  });

  it("counts only this worktree's listed test files, and says nothing while one has no closure", async () => {
    const r = await repo();
    // Another worktree's test file reads it; this worktree does not list that file.
    closure(r, { project: "", path: "other.test.ts" }, ["other.test.ts", "scripts/a.mjs"]);
    edit(r, ["scripts/a.mjs"]);
    expect(await boundary(r)).toBe(`SQUEAL · ${told("scripts/a.mjs")}`);

    r.store.testFiles.remove(FILE);
    edit(r, ["scripts/b.mjs"]);
    expect(await boundary(r)).toBe("");
  });

  it("writes nothing with delivery.uncoveredEdits off", async () => {
    const r = await repo();
    r.policy({ delivery: { uncoveredEdits: false } });
    edit(r, ["scripts/a.mjs"]);
    expect(await boundary(r)).toBe("");
    expect(r.store.meta.get(uncoveredMetaKey(r.worktreeId))).toBeNull();
  });

  it("gives way to the not-validated line while no daemon validates, and comes once it does", async () => {
    const r = await repo();
    r.daemon("stale", Date.UTC(2026, 0, 2, 14, 2));
    edit(r, ["scripts/a.mjs"]);
    const down = await boundary(r, { ...alive, ensureDaemon: async () => "unavailable" });
    expect(down).toContain("Not validated: no daemon has validated since 2026-01-02T14:02:00.000Z");
    expect(down).not.toContain("No result for");

    r.daemon("alive");
    expect(await boundary(r)).toContain(told("scripts/a.mjs"));
  });

  it("is removed with the worktree", async () => {
    const r = await repo();
    edit(r, ["scripts/a.mjs"]);
    await boundary(r);
    expect(r.store.meta.get(uncoveredMetaKey(r.worktreeId))).not.toBeNull();
    r.store.worktrees.remove(r.worktreeId);
    expect(r.store.meta.get(uncoveredMetaKey(r.worktreeId))).toBeNull();
  });

  it("counts against the delivery cap", async () => {
    const r = await repo();
    // Each with an error of its own, so none groups with another (row 011-109).
    const failing = Array.from({ length: 200 }, (_, i) =>
      r.fail(check(`math > case ${i}`, FILE), `${i} ${"x".repeat(300)}`),
    );
    edit(r, ["scripts/a.mjs"]);
    r.apply(...failing);
    const text = await boundary(r);
    expect(text.endsWith(`\n${told("scripts/a.mjs")}`)).toBe(true);
    expect(text).toContain("Not shown:");
    expect(text.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
  });

  it("is said by the Codex hook too", async () => {
    const r = squealRepo();
    closure(r, FILE, ["src/math.test.ts", "src/math.ts"]);
    r.apply(r.pass());
    const session = sessionOf("exec", "post-tool-use-apply-patch");
    await runCodexHook(
      "session-start",
      codexRecorded("exec", "session-start", r.root, session),
      alive,
    );
    edit(r, ["a.js"]);
    const out = await runCodexHook(
      "post-tool-use",
      codexRecorded("exec", "post-tool-use-apply-patch", r.root),
      alive,
    );
    expect(out.stdout).toContain(told("a.js"));
  });
});
