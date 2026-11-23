import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, link, ref, write } from "../commit/at-keys-fixture.js";
import { SLOW } from "../daemon/helpers.js";
import { run, testOf } from "./status-at-kit.js";
import { realCommitDaemon } from "./status-at-real-daemon.js";

/*
 * Row 023-40c (the coordinator, before review: no result that ran on a tree
 * that differs from the commit is the commit's), with a real commit daemon
 * in this process. D4.9: a file whose closure reads a path git does not
 * hold at the commit, which its install wrote, is refused in the selection
 * and reads `not comparable (needs <path>)`; the others run. Row 023-07's
 * whole-checkout check after the install: an install that rewrites a
 * tracked file leaves every file of the commit not comparable, and nothing
 * runs there.
 */

const GEN = ref("test/gen.test.ts");
const PLAIN = ref("test/plain.test.ts");
const LISTS = ref("test/lists.test.ts");
const READS = ref("test/reads.test.ts");

type Side = { state: string; reason?: string };
const atOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === path)?.at;

describe("the commit daemon refuses what is not the commit's (row 023-40c)", SLOW, () => {
  it("refuses a file whose closure reads a path the install wrote and git does not hold (D4.9)", {
    timeout: 180_000,
  }, async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      ".gitignore": "node_modules/\nsrc/gen.ts\n",
      "src/plain.ts": "export const value = 1;\n",
      [GEN.path]: testOf("gen", 1),
      [PLAIN.path]: testOf("plain", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
    // The install writes a source git does not hold, which `gen.test.ts` loads.
    const install = async (tree: AbsolutePath) => {
      link(tree);
      write(tree, { "src/gen.ts": "export const value = 1;\n" });
      return { ok: true, command: "link", ms: 0 } as const;
    };
    const real = realCommitDaemon(f.root, { install });

    const called = await run(
      f,
      { commit: a, json: true, run: { allMissing: true }, waitMs: 120_000 },
      { cacheRoot: f.cacheRoot, daemons: real.daemons },
    );
    expect(atOf(called.out, GEN.path), called.err).toEqual({
      state: "not comparable",
      reason: "needs src/gen.ts",
    });
    expect(atOf(called.out, PLAIN.path)).toMatchObject({ state: "pass" });
    expect(JSON.parse(called.out).run.commit).toMatchObject({ files: 1, known: 1 });
  });

  it("review 0.1.597 B1: refuses a file whose recorded reads list a folder the install added a name to (D4.9)", {
    timeout: 240_000,
  }, async () => {
    const lists = [
      'import { readdirSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'import { value } from "../src/plain";',
      'it("lists", () => expect(readdirSync(new URL("./fixtures", import.meta.url)).length).toBe(value));',
      "",
    ].join("\n");
    const f = fixture({
      "squeal.config.json": "{}\n",
      ".gitignore": "node_modules/\n*.log\n",
      "src/plain.ts": "export const value = 1;\n",
      "test/fixtures/a.json": "{}\n",
      [LISTS.path]: lists,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const b = f.commit({ "src/plain.ts": "export const value = 1; // b\n" });
    f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
    // From the second commit on, the install writes an ignored name into the listed folder.
    let installs = 0;
    const install = async (tree: AbsolutePath) => {
      link(tree);
      installs += 1;
      if (installs > 1) write(tree, { "test/fixtures/extra.log": "x" });
      return { ok: true, command: "link", ms: 0 } as const;
    };
    const real = realCommitDaemon(f.root, { install });
    const options = { cacheRoot: f.cacheRoot, daemons: real.daemons };
    const ask = { json: true, run: { allMissing: true }, waitMs: 120_000 } as const;

    // The first run records the folder it lists. The folder's key hashes its tracked names
    // only, so a result stored from a listing with ignored or untracked names would stand
    // for the commit's: the next commit's daemon, whose folder holds an ignored name the
    // commit does not track, refuses the file (row 023-64: only a listing equal to the
    // commit's is held).
    const first = await run(f, { commit: a, ...ask }, options);
    expect(atOf(first.out, LISTS.path), first.err).toMatchObject({ state: "pass" });
    const second = await run(f, { commit: b, ...ask }, options);
    expect(atOf(second.out, LISTS.path), second.err).toEqual({
      state: "not comparable",
      reason: "needs test/fixtures/",
    });
  });

  it("row 023-48 (V1): runs a file that reads a path under a tracked directory symlink", {
    timeout: 240_000,
  }, async () => {
    const reads = [
      'import { readFileSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'import { value } from "../src/plain";',
      'const url = new URL("../.agents/skills/a/SKILL.md", import.meta.url);',
      'it("reads", () => expect(readFileSync(url, "utf8").length).toBe(value));',
      "",
    ].join("\n");
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/plain.ts": "export const value = 1;\n",
      ".ai/skills/a/SKILL.md": "a",
      [READS.path]: reads,
    });
    mkdirSync(join(f.root, ".agents/skills"), { recursive: true });
    symlinkSync("../../.ai/skills/a", join(f.root, ".agents/skills/a"));
    const a = f.commit({ "src/plain.ts": "export const value = 1; // a\n" });
    const b = f.commit({ "src/plain.ts": "export const value = 1; // b\n" });
    f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
    const real = realCommitDaemon(f.root);
    const options = { cacheRoot: f.cacheRoot, daemons: real.daemons };
    const ask = { json: true, run: { allMissing: true }, waitMs: 120_000 } as const;

    // The first run records the read through the link; the next commit's daemon holds it there.
    const first = await run(f, { commit: a, ...ask }, options);
    expect(atOf(first.out, READS.path), first.err).toMatchObject({ state: "pass" });
    const second = await run(f, { commit: b, ...ask }, options);
    expect(atOf(second.out, READS.path), second.err).toMatchObject({ state: "pass" });
  });

  it("runs nothing on a tree the install changed, and says which path", {
    timeout: 180_000,
  }, async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      "src/plain.ts": "export const value = 1;\n",
      [PLAIN.path]: testOf("plain", 1),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
    // The install rewrites a file the commit tracks.
    const install = async (tree: AbsolutePath) => {
      link(tree);
      write(tree, { "src/plain.ts": "export const value = 2;\n" });
      return { ok: true, command: "link", ms: 0 } as const;
    };
    const real = realCommitDaemon(f.root, { install });

    const called = await run(
      f,
      { commit: a, json: true, run: { allMissing: true }, waitMs: 120_000 },
      { cacheRoot: f.cacheRoot, daemons: real.daemons },
    );
    const report = JSON.parse(called.out);
    expect(report, called.err).toMatchObject({ changed: "src/plain.ts", changedBy: "install" });
    expect(atOf(called.out, PLAIN.path)).toEqual({
      state: "not comparable",
      reason: "install changed the checkout: src/plain.ts",
    });
    expect(report.run.commit).toMatchObject({ files: 0 });
  });
});
