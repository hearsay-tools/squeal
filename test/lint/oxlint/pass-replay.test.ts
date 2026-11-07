import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { blobHash } from "../../../src/core/hash/blob.js";
import { createLintPass } from "../../../src/core/lint/pass/index.js";
import { oxlintProvider } from "../../../src/core/lint/provider/oxlint/provider.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import { commonDir, LINT_ON, open } from "../helpers.js";
import { DiskWorktree } from "./disk.js";
import { project } from "./helpers.js";
import { edits, FIXTURE, type Mode, schedule, truth } from "./replay.js";

/*
 * Spec 017 D11, row 017-15's done-when: the 017-12 replay, modes A (the
 * import plugin) and C (plus a JS plugin that imports a module and reads a
 * file), through the daemon's lint pass with the real oxlint provider.
 * After each edit is stored as a revision and the pass is idle, every
 * module file's oxlint check must equal a fresh whole CLI run: no check for
 * a file oxlint ignores, else judged at the bytes on disk with the same
 * findings. Stale files lint at once (`idleIn` 0). An installed package's
 * edit also rewrites `package-lock.json`, as an install does, and the
 * install fingerprint (011 C11) reads the package's files.
 */

const STEPS = Number(process.env.SQUEAL_OXLINT_REPLAY_STEPS ?? 0);
const SEED = 24;
const MODULES = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const WORKTREE = "w1";

const sha = (bytes: string | Buffer) => createHash("sha1").update(bytes).digest("hex");

/** Each module file's oxlint check, as `truth` words a result; `stale` and the rest by name. */
function stored(store: LintStore, root: string): Map<RelativePath, string> {
  const out = new Map<RelativePath, string>();
  for (const s of store.states.list(WORKTREE, { tool: "oxlint" })) {
    const path = s.check.path;
    if (!MODULES.has(extname(path))) continue;
    const judged = s.judged;
    const disk = blobHash(readFileSync(join(root, path)), "sha1");
    if (s.outcome === "pending" || s.outcome === "unknown" || s.stale || judged === null) {
      out.set(path, `${s.outcome}${s.stale ? "+stale" : ""}: ${s.reason ?? ""}`);
    } else if (judged.blob !== disk) out.set(path, "judged at other bytes");
    else {
      const findings = store.results.get(s.check, judged.key)?.findings;
      out.set(
        path,
        findings === undefined
          ? "result not stored"
          : JSON.stringify(
              findings
                .map((f) => `${f.rule}|${f.severity}|${f.message}|${f.line}:${f.column}`)
                .sort(),
            ),
      );
    }
  }
  return out;
}

const waiting = (store: LintStore) =>
  store.states.list(WORKTREE, { tool: "oxlint" }).some((s) => s.outcome === "pending" || s.stale);

async function replay(mode: Mode) {
  const root = project(FIXTURE) as AbsolutePath;
  spawnSync("git", ["init", "-q", root]);
  const { edits: list, start } = edits(mode, root);
  start();
  const plan = schedule(list, STEPS, SEED);
  const disk = new DiskWorktree(root);
  const dir = commonDir();
  const installed = () =>
    Promise.resolve(
      sha(
        ["index.js", "index.d.ts", "package.json"]
          .map((n) => readFileSync(join(root, "node_modules/probe-dep", n), "utf8"))
          .join("\0"),
      ),
    );
  const errors: Error[] = [];
  let opened = 0;
  const pass = createLintPass({
    worktreeId: WORKTREE,
    tool: "oxlint",
    root,
    commonDir: dir,
    format: "sha1",
    source: disk.source,
    policy: () => LINT_ON,
    provider: () => {
      opened++;
      return oxlintProvider({ root, env: { PATH: process.env.PATH } });
    },
    installed,
    idleIn: () => 0,
    log: () => {},
    onError: (error) => errors.push(error),
  });
  const store = open(dir);
  const settle = async () => {
    for (let round = 0; round < 40; round++) {
      pass.nudge();
      await pass.idle();
      if (!waiting(store)) return;
      await sleep(100);
    }
  };
  const wrong: string[] = [];
  let lockfile = 0;
  try {
    for (let step = 0; step <= plan.length; step++) {
      const edit = step === 0 ? null : (plan[step - 1] ?? null);
      edit?.apply();
      if (edit?.category === "installed-package") {
        writeFileSync(
          join(root, "package-lock.json"),
          `{ "lockfileVersion": 3, "n": ${++lockfile} }\n`,
        );
      }
      disk.revise();
      await settle();
      const files = disk.source.files().map((f) => f.path);
      const modules = files.filter((f) => MODULES.has(extname(f)));
      const want = truth(root, modules);
      const have = stored(store, root);
      for (const f of modules) {
        const expected = want.get(f) === "ignored" ? undefined : want.get(f);
        if (have.get(f) !== expected)
          wrong.push(`${step} ${edit?.name}: ${f} ${have.get(f)} != ${expected}`);
      }
    }
  } finally {
    await pass.close();
  }
  return { steps: plan.length, wrong, errors: errors.map((e) => e.message), opened };
}

describe("the 017-12 replay through the daemon's lint pass (017 D11)", () => {
  for (const mode of ["A", "C"] as const) {
    it(`mode ${mode}: after each edit every oxlint check equals a fresh whole run`, {
      timeout: 600_000,
    }, async () => {
      const result = await replay(mode);
      expect(result.wrong).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(result.opened).toBe(1);
      expect(result.steps).toBeGreaterThanOrEqual(mode === "A" ? 42 : 51);
    });
  }
});
