import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { runGateFiles } from "../../src/cli/code-gate-files.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { quiet } from "../code/gate/host-load.js";
import { fixture, git, linkInstall, passesAt, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";
import { inProcessCommitDaemons } from "./status-at-real-daemon.js";

/*
 * Review 0.1.597 (row 023-42, spec 023 D4.9, D5.2, D7.6), on the
 * reviewer's probes. B1: a folder the test lists is no blob, and its key
 * hashes the tracked names only, so a stored pass from a caller whose
 * listing holds an ignored name must not stand for the commit's: the
 * green side reads `needs test/fixtures/`. B2: a proof D5.2 stops runs
 * nothing, so the persistent commit daemon is asked for no green run: the
 * test's side effect never appears in its worktree. B3: every git read on
 * the green path ends by the proof's `--timeout`: the commit's allowlist
 * (the daemon's fingerprint) and the D4.9 tree reads after its setup. A
 * git that never answers in time is a wrapper that stalls only that read.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/**
 * Puts a `git` first on `PATH` that stalls 20 s, after touching the
 * returned marker, when `stalls` (a shell test over `"$@"`) holds, and
 * otherwise runs the real git. Restored at the test's end.
 */
function stalledGit(stalls: string): string {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-git-")));
  const marker = join(dir, "stalled");
  const script = [
    "#!/bin/sh",
    `if ${stalls}; then`,
    `  : > "${marker}"`,
    "  exec sleep 20",
    "fi",
    `exec "${real}" "$@"`,
    "",
  ].join("\n");
  writeFileSync(join(dir, "git"), script);
  chmodSync(join(dir, "git"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path ?? ""}`;
  onTestFinished(() => {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });
  return marker;
}

/** Commit A holds the bug (`value` 1); HEAD fixes it and adds the test that expects 2. */
function sourceFix() {
  const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a };
}

/** Commit daemons in this process that live across the test's calls; stopped at its end. */
function kept() {
  const kit = inProcessCommitDaemons({ install: linkInstall().install });
  onTestFinished(() => kit.stop());
  return kit;
}

describe("review 0.1.597: the proof's green side on the commit daemon", SLOW, () => {
  it("B1: a stored pass from a caller listing with an ignored name is not the commit's", async () => {
    const f = fixture({
      ...ON,
      ".gitignore": "node_modules/\n*.log\n",
      "src/a.ts": "export const value = 1;\n",
      "test/fixtures/a.json": "{}\n",
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const lists = [
      'import { readdirSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'import { value } from "../src/a";',
      'it("value", () => {',
      "  expect(value).toBe(2);",
      '  expect(readdirSync(new URL("./fixtures", import.meta.url)).length).toBe(2);',
      "});",
      "",
    ].join("\n");
    const head = f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: lists });
    // Only the caller's listing holds the ignored name; git sees a clean tree.
    writeFileSync(join(f.root, "test/fixtures/extra.log"), "x\n");
    const seeded = await runGateFiles({
      root: f.root,
      files: [TEST.path],
      budgetSeconds: 120,
      hostLoad: quiet,
    });
    expect(seeded.runs.map((r) => r.outcome)).toEqual(["passed"]);
    expect(git(f.root, "status", "--porcelain")).toBe("");
    expect(passesAt(f, head, TEST)).toBe(false);

    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const result = await prove(f, { files: [TEST.path], base: a, case: "source" }, options);
    expect(result.code, result.why).toBe(3);
    expect(result.files[0], result.why).toMatchObject({ verdict: "not comparable" });
    expect(result.out).toContain("needs test/fixtures/");
    expect(result.files[0]?.green).not.toMatchObject({ end: "pass" });
    await kit.stop();
    clean(f);
  });

  it("B2: a proof D5.2 stops asks the commit daemon for no green run", async () => {
    const marked = [
      'import { writeFileSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      'import { value } from "../src/a";',
      'it("value", () => {',
      '  writeFileSync(new URL("../ran.marker", import.meta.url), "");',
      "  expect(value).toBe(2);",
      "});",
      "",
    ].join("\n");
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 1;\n",
      "docs/info.md": "a\n",
      [TEST.path]: marked,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", "docs/info.md": "b\n" });
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const result = await prove(f, { files: [TEST.path], base: a, source: ["src/a.ts"] }, options);
    expect(result.code, result.why).toBe(3);
    expect(result.out).toContain("docs/info.md");
    expect(result.report.runs).toBe(0);
    expect(kit.started).toHaveLength(1);
    const tree = kit.started[0] as AbsolutePath;
    // Whatever the daemon was asked has finished once its wait returns.
    expect(await kit.daemons.wait(tree, [TEST], Date.now() + 60_000)).toBeNull();
    expect(existsSync(join(tree, "ran.marker"))).toBe(false);
    await kit.stop();
    clean(f);
  });

  it("B3: the commit's allowlist read ends by --timeout and reads not run (budget)", async () => {
    const { f, a } = sourceFix();
    const marker = stalledGit(
      '[ "$1" = show ] && case "$2" in *:squeal.config.json) true ;; *) false ;; esac',
    );
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const started = performance.now();
    const result = await prove(f, { files: [TEST.path], base: a, timeoutSeconds: 1 }, options);
    expect(performance.now() - started).toBeLessThan(1_000 + 2_500);
    expect(existsSync(marker)).toBe(true);
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({ verdict: "not comparable", reason: "budget" });
    expect(result.report.rerun).toContain("--timeout 60");
    expect(kit.started).toEqual([]);
    clean(f);
  });

  it("B3: the D4.9 tree reads after the daemon's setup end by --timeout", async () => {
    const { f, a } = sourceFix();
    // `git ls-tree -r -z --full-tree HEAD` in the caller's root: the D4.9 read of HEAD's tree.
    const marker = stalledGit(
      `[ "$1" = ls-tree ] && [ "$5" = HEAD ] && [ "$(pwd -P)" = "${f.root}" ]`,
    );
    const kit = kept();
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: kit.daemons,
    };
    const started = performance.now();
    const result = await prove(f, { files: [TEST.path], base: a, timeoutSeconds: 10 }, options);
    expect(performance.now() - started).toBeLessThan(10_000 + 2_500);
    expect(existsSync(marker), result.why).toBe(true);
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({ verdict: "not comparable", reason: "budget" });
    expect(kit.started).toHaveLength(1);
    await kit.stop();
    clean(f);
  });
});
