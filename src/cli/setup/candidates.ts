import { posix } from "node:path";
import { globToRegExp } from "../../core/keys/glob.js";
import type { Policy } from "../../core/types/index.js";
import { parseTestScript } from "../node-test-seed.js";
import type { Runners, SlowFacts, SlowGroup } from "./plan.js";
import { type Manifest, type RepoFacts, scriptsOf } from "./repo.js";

/*
 * Spec 005 D3, "Slow tests and their inputs", step 1: slow candidates from
 * static evidence, grouped by directory. Checked against hand declarations in
 * `research/wave-0-checks.md` 7. No artifact is proposed (004 D5 as amended
 * 2026-10-18, task 004-81: Squeal covers no test of a build output).
 */

/** The npm scripts whose test files are slow candidates (D3 step 1). */
const SLOW_SCRIPTS = ["test:e2e", "e2e", "test:integration", "test:package"];
const NODE_TEST = "node:test project";

export async function slowCandidates(
  facts: RepoFacts,
  policy: Policy,
  runners: Runners,
): Promise<SlowFacts> {
  const projects = runners.nodeTest.map((p) => ({
    name: p.name,
    files: facts.tracked.filter(globMatcher(p.include.map((g) => posix.join(p.cwd, g)))),
    slow: policy.nodeTest.some((q) => q.name === p.name && q.slow === true),
  }));
  const universe = [...new Set([...facts.testFiles.paths, ...projects.flatMap((p) => p.files)])];
  const reasons = new Map<string, Set<string>>();
  const add = (file: string, why: string) => {
    reasons.set(file, (reasons.get(file) ?? new Set()).add(why));
  };
  for (const file of universe) {
    if (file.split("/").slice(0, -1).includes("e2e")) add(file, "under a directory named e2e");
    if (posix.basename(file).includes(".e2e.")) add(file, "named *.e2e.*");
  }
  const known = new Set(universe);
  const unresolvedScripts: string[] = [];
  for (const manifest of facts.manifests) {
    for (const [name, text] of scriptsOf(manifest)) {
      if (!SLOW_SCRIPTS.includes(name)) continue;
      const where = `${manifest.dir || "."}:${name}`;
      const files = scriptFiles(facts, manifest, name, universe, 0);
      if (files === null) unresolvedScripts.push(`${where} = ${text}`);
      // Only files Squeal validates: a fixture package's own scripts name none of them.
      else for (const file of files) if (known.has(file)) add(file, `run by npm script ${where}`);
    }
  }
  for (const p of projects) for (const file of p.files) add(file, `${NODE_TEST} ${p.name}`);

  const declared = globMatcher(policy.slow.include);
  const slowProject = new Set(projects.filter((p) => p.slow).flatMap((p) => p.files));
  const isDeclared = (file: string) => declared(file) || slowProject.has(file);
  for (const file of universe) if (isDeclared(file)) add(file, "declared slow");

  const byDir = new Map<string, string[]>();
  for (const file of [...reasons.keys()].sort()) {
    const dir = posix.dirname(file);
    byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
  }
  const groups: SlowGroup[] = [];
  for (const [dir, files] of byDir) {
    const why = [...new Set(files.flatMap((f) => [...(reasons.get(f) ?? [])]))];
    const declaredInputs = inputsFor(policy, files);
    groups.push({
      dir,
      files,
      reasons: why,
      // 005-04: a node:test project alone is not a slow group (cezarion's `test/unit`).
      defaultSlow: why.some((r) => !r.startsWith(NODE_TEST)),
      declaredSlow: files.some(isDeclared),
      declaredInputs,
    });
  }
  return { groups, unresolvedScripts };
}

/**
 * The test files an npm script runs, when a static rule resolves it:
 * `node [flags] --test <globs>`, `npm run <script> [-w <package>]`, or
 * `vitest run <paths>`. `null` otherwise.
 */
function scriptFiles(
  facts: RepoFacts,
  manifest: Manifest,
  name: string,
  universe: readonly string[],
  depth: number,
): string[] | null {
  const text = scriptsOf(manifest).find(([n]) => n === name)?.[1];
  if (text === undefined || depth > 4) return null;
  const parsed = parseTestScript(text);
  if (parsed !== null && typeof parsed !== "string") {
    return facts.tracked.filter(
      globMatcher(parsed.include.map((g) => posix.join(manifest.dir, g))),
    );
  }
  const npm = /^npm run (\S+)(?: (?:-w|--workspace)(?: |=)(\S+))?\s*$/.exec(text);
  if (npm !== null) {
    const target = npm[2] === undefined ? manifest : packageNamed(facts, npm[2]);
    return target === null
      ? null
      : scriptFiles(facts, target, npm[1] as string, universe, depth + 1);
  }
  const vitest = /^vitest run((?: [^-\s]\S*)+)\s*$/.exec(text);
  if (vitest !== null) {
    const prefixes = (vitest[1] as string)
      .trim()
      .split(/\s+/)
      .map((p) => posix.join(manifest.dir, p));
    return universe.filter((file) =>
      prefixes.some((p) => file === p || file.startsWith(`${p.replace(/\/$/, "")}/`)),
    );
  }
  return null;
}

/** A workspace package by its `name`, or by its directory. */
function packageNamed(facts: RepoFacts, name: string): Manifest | null {
  return (
    facts.manifests.find((m) => m.value.name === name) ??
    facts.manifests.find((m) => m.dir === name.replace(/^\.\//, "").replace(/\/$/, "")) ??
    null
  );
}

/** The `inputs` globs that apply to any of `files` (001 D11: a list applies to every file). */
function inputsFor(policy: Policy, files: readonly string[]): string[] {
  const { inputs } = policy;
  if (Array.isArray(inputs)) return [...(inputs as readonly string[])];
  const out: string[] = [];
  for (const [testGlob, globs] of Object.entries(inputs as Record<string, readonly string[]>)) {
    if (files.some(globMatcher([testGlob]))) out.push(...globs.filter((g) => !out.includes(g)));
  }
  return out;
}

/** A matcher for globs that never throws: a glob Squeal cannot compile matches nothing. */
function globMatcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.flatMap((glob) => {
    try {
      return [globToRegExp(glob)];
    } catch {
      return [];
    }
  });
  return (path) => patterns.some((pattern) => pattern.test(path));
}
