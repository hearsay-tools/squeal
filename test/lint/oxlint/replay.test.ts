import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { blobHash } from "../../../src/core/hash/blob.js";
import type { LintFileInputs, LintRunReport } from "../../../src/core/lint/pass/provider.js";
import { isOxlintConfigInput } from "../../../src/core/lint/provider/oxlint/index.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/index.js";
import { OXLINT_PACKAGE, project, provider } from "./helpers.js";
import { edits, FIXTURE, type Mode, schedule } from "./replay.js";

/*
 * Spec 017 D11, row 017-14's done-when: the 017-12 probe's replay, modes A
 * (the import plugin) and C (plus a JS plugin that imports a module and
 * reads a file), through the provider. After each edit a fresh whole CLI
 * run is the truth. A key built only from what the provider reports (its
 * declaration, closure and held bytes, each file's inputs, and D5's
 * program segment for whole-program files) must never be seen again with
 * another result; the files whose key is new are linted in parts and must
 * equal the truth. `SQUEAL_OXLINT_REPLAY_STEPS=110` runs the probe's length;
 * the default runs each edit three times.
 */

const STEPS = Number(process.env.SQUEAL_OXLINT_REPLAY_STEPS ?? 0);
const SEED = 24;
const MODULE = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".json"]);

const sha = (bytes: string | Buffer) => createHash("sha1").update(bytes).digest("hex");
const blob = (root: string, rel: string) => {
  try {
    return sha(readFileSync(join(root, rel)));
  } catch {
    return null;
  }
};

const gitBlob = (root: string, rel: string) => {
  try {
    return blobHash(readFileSync(join(root, rel)), "sha1");
  } catch {
    return null;
  }
};

/** Every file but `node_modules` and `.git`: what git would list, the fixture ignoring only `node_modules`. */
function listing(root: string, dir = ""): RelativePath[] {
  const out: RelativePath[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") out.push(...listing(root, rel));
    } else out.push(rel as RelativePath);
  }
  return out.sort();
}

/** The truth: a fresh whole run, and which files a whole walk lints; a file's result as one string. */
function truth(root: string, files: readonly RelativePath[]): Map<RelativePath, string> {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [join(OXLINT_PACKAGE, "bin/oxlint"), "--threads", "1", ...args], {
      cwd: root,
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    }).stdout;
  const linted = new Set(
    run(["--debug", "files"])
      .split("\n")
      .map((l) => l.trim()),
  );
  const report = JSON.parse(run(["--format", "json"])) as {
    diagnostics: {
      code?: string;
      severity: string;
      message: string;
      filename: string;
      labels?: { span: { line: number; column: number } }[];
    }[];
  };
  const by = new Map<string, string[]>();
  for (const d of report.diagnostics) {
    const span = d.labels?.[0]?.span;
    const list = by.get(d.filename) ?? [];
    list.push(
      `${d.code ?? null}|${d.severity}|${d.message}|${span?.line ?? 0}:${span?.column ?? 0}`,
    );
    by.set(d.filename, list);
  }
  return new Map(
    files.map((f) => [f, linted.has(f) ? JSON.stringify((by.get(f) ?? []).sort()) : "ignored"]),
  );
}

function given(report: LintRunReport, file: RelativePath): string {
  const result = report.results.get(file);
  if (result === undefined) return "no result";
  if ("unknown" in result) return `unknown: ${result.unknown}`;
  return JSON.stringify(
    result.findings.map((f) => `${f.rule}|${f.severity}|${f.message}|${f.line}:${f.column}`).sort(),
  );
}

async function replay(mode: Mode) {
  const root = project(FIXTURE) as AbsolutePath;
  spawnSync("git", ["init", "-q", root]);
  const { edits: list, start } = edits(mode, root);
  start();
  const plan = schedule(list, STEPS, SEED);
  const lint = provider(root);
  expect(await lint.open()).toMatchObject({ tool: "oxlint" });
  const store = new Map<string, string>();
  const misses: string[] = [];
  const parts: string[] = [];
  const ignored: string[] = [];
  const races: string[] = [];
  let inputs = new Map<RelativePath, LintFileInputs>();
  let before = new Map<string, string | null>();
  let linted = 0;
  for (let step = 0; step <= plan.length; step++) {
    const edit = step === 0 ? null : (plan[step - 1] ?? null);
    edit?.apply();
    const files = listing(root);
    const now = new Map(files.map((f) => [f as string, blob(root, f)]));
    const install = JSON.stringify(
      ["index.js", "index.d.ts", "package.json"].map((n) =>
        blob(root, `node_modules/probe-dep/${n}`),
      ),
    );
    now.set("(install)", install);
    const changed = [...new Set([...now.keys(), ...before.keys()])].filter(
      (p) => now.get(p) !== before.get(p),
    );
    before = now;
    // The pass's refresh: an install a new thread, a config input or a closure file a new instance.
    const snapshot0 = await lint.refresh("none");
    if ("off" in snapshot0) throw new Error(snapshot0.off);
    const closure0 = new Set([...snapshot0.closure, ...snapshot0.declaration.configFiles]);
    const level = changed.includes("(install)")
      ? "thread"
      : changed.some(
            (p) => isOxlintConfigInput(p as RelativePath) || closure0.has(p as RelativePath),
          )
        ? "instance"
        : "none";
    const snapshot = level === "none" ? snapshot0 : await lint.refresh(level);
    if ("off" in snapshot) throw new Error(snapshot.off);
    const modules = files.filter((f) => MODULE.has(extname(f)) && extname(f) !== ".json");
    const asked =
      level === "none" && step > 0 ? modules.filter((f) => changed.includes(f)) : modules;
    const fresh = await lint.inputs(asked);
    if (level !== "none" || step === 0) inputs = new Map(fresh);
    else
      for (const f of asked)
        fresh.has(f) ? inputs.set(f, fresh.get(f) as LintFileInputs) : inputs.delete(f);
    const want = truth(root, modules);
    for (const f of modules) {
      if ((want.get(f) === "ignored") === inputs.has(f))
        ignored.push(`${step} ${edit?.name}: ${f}`);
    }
    // A key from the provider's report alone, plus the listing's module blobs for D5's segment.
    const segment = JSON.stringify(
      files.filter((f) => MODULE.has(extname(f))).map((f) => [f, now.get(f)]),
    );
    const keyOf = (f: RelativePath, s: { closure: readonly RelativePath[] }) => {
      const env = [...new Set([...s.closure, ...snapshot.declaration.configFiles])].sort();
      const input = inputs.get(f) as LintFileInputs;
      return sha(
        JSON.stringify([
          f,
          now.get(f),
          snapshot.declaration,
          snapshot.env,
          install,
          env.map((p) => [p, blob(root, p)]),
          input.config,
          input.wholeProgram ? segment : null,
        ]),
      );
    };
    let current: { closure: readonly RelativePath[] } = snapshot;
    const todo = [...inputs.keys()].filter((f) => !store.has(keyOf(f, current)));
    for (let i = 0; i < todo.length; i += 16) {
      const part = todo.slice(i, i + 16);
      const report = await lint.lint(
        part.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") })),
      );
      if ("off" in report) throw new Error(report.off);
      linted += part.length;
      for (const f of part) {
        if (given(report, f) !== want.get(f))
          parts.push(`${step} ${edit?.name}: ${f} ${given(report, f)} != ${want.get(f)}`);
      }
      // What the run held is what is on disk: no edit ran beside it.
      for (const [path, use] of report.held ?? []) {
        const disk = gitBlob(root, path);
        if (use.unobserved === true || use.others.some((b) => b !== disk))
          races.push(`${step}: ${path}`);
      }
      current = report;
    }
    for (const f of inputs.keys()) {
      const key = keyOf(f, current);
      const result = want.get(f) as string;
      const seen = store.get(key);
      if (seen !== undefined && seen !== result)
        misses.push(`${step} ${edit?.category} ${edit?.name}: ${f} was ${seen} now ${result}`);
      store.set(key, result);
    }
  }
  return { steps: plan.length, linted, misses, parts, ignored, races };
}

describe("the 017-12 replay through the oxlint provider", () => {
  for (const mode of ["A", "C"] as const) {
    it(`mode ${mode}: every part equals a fresh whole run, and no key from the provider's report misses`, {
      timeout: 600_000,
    }, async () => {
      const result = await replay(mode);
      expect(result.parts).toEqual([]);
      expect(result.ignored).toEqual([]);
      expect(result.misses).toEqual([]);
      expect(result.races).toEqual([]);
      expect(result.steps).toBeGreaterThanOrEqual(mode === "A" ? 42 : 51);
      expect(result.linted).toBeGreaterThan(result.steps);
    });
  }
});
