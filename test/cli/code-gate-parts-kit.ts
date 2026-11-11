import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PART_PREFIX, type Part } from "../../src/core/ci/parts.js";
import type { GateReport, GateRunReport } from "../../src/core/code/gate/report.js";
import { resolveCommonDir } from "../../src/core/fs/git-layout.js";
import { storePaths } from "../../src/core/store/paths.js";
import { committed, scratch, writeFiles } from "../ci/fixture.js";
import { watched } from "../code/gate/collect-fixture.js";
import { MATH_FILES, recordCovered } from "../runners/vitest/ci-coverage-kit.js";
import { code } from "./code-gate-fixture.js";

/*
 * Spec 020 D13.2 (row 020-08b): a repository whose working tree changes
 * `src/math.ts` against its one commit, parts `squeal ci record` wrote of
 * it, and `squeal code --base HEAD` with the files each Vitest run ran.
 */

/** Each case runs `ci record` and up to two gates, each a real Vitest; a loaded host needs headroom. */
export const SLOW = { timeout: 300_000 } as const;

/** The base: `src/math.ts` with `add` alone; the working tree adds the rest of `MATH_FILES`'s. */
const BASE: Readonly<Record<string, string>> = {
  ...MATH_FILES,
  "src/math.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
};

/**
 * A test that reads `data/input.txt` at run time, outside every import
 * graph: the part's observed reads certify it.
 */
export const READS: Readonly<Record<string, string>> = {
  "data/input.txt": "hello\n",
  "test/reads.test.ts": `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\n\nit("reads its input", () => {\n  expect(readFileSync(new URL("../data/input.txt", import.meta.url), "utf8").length).toBeGreaterThan(0);\n});\n`,
};

/** CC 6, which no test runs: CRAP 42, over 30, unless a skipped test may run it (D11.3). */
export const RISKY = `export function risky(n: number): string {\n${[1, 2, 3, 4, 5]
  .map((n) => `  if (n === ${n}) {\n    return "${n}";\n  }\n`)
  .join("")}  return "many";\n}\n`;

export interface Recorded {
  readonly root: string;
  /** The directory `ci record` wrote its part into. */
  readonly parts: string;
}

/**
 * The fixture in `dir`, with `files` written over `MATH_FILES` before the
 * commit and `edits` written after it, and `ci record`'s parts of the
 * working tree.
 */
export async function recorded(
  files: Readonly<Record<string, string>> = {},
  edits: Readonly<Record<string, string>> = {},
  dir: string = scratch("gate-parts"),
): Promise<Recorded> {
  const root = committed(dir, { ...BASE, ...files });
  writeFiles(root, { "src/math.ts": MATH_FILES["src/math.ts"] as string, ...edits });
  return { root, parts: await recordInto(root, "parts") };
}

/**
 * The directory `name` beside `root`, with the part of `ci record` over
 * `vitest run <args>` in `root`. `CI` is set, as in a CI job: Vitest then
 * writes no snapshot (`updateSnapshot: "none"`) unless `args` asks it to,
 * and a part of a run that could write one gives no evidence (018 D9).
 */
export async function recordInto(
  root: string,
  name: string,
  args: readonly string[] = [],
): Promise<string> {
  const parts = join(dirname(root), name);
  const run = await recordCovered(root, parts, args, undefined, { ...process.env, CI: "true" });
  if (run.parts.length !== 1) throw new Error(`ci record wrote no part: ${run.said}`);
  return parts;
}

export interface Gated {
  readonly code: number;
  readonly report: GateReport;
  readonly stderr: string;
  /** The test files the gate ran. */
  readonly ran: readonly string[];
}

/**
 * `squeal code --base HEAD <args> --json` in `root`, with `env` as the
 * command's environment. The gate's Vitest runs in this process, so its
 * tests see `process.env`: a case that varies a variable sets both.
 */
export async function gate(
  root: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<Gated> {
  const ran: string[] = [];
  const options = { env, adapters: watched(ran) };
  const result = await code(root, ["--base", "HEAD", ...args, "--json"], options);
  const { stdout, stderr } = result;
  if (stdout === "") throw new Error(`squeal code exited ${result.code}: ${stderr}`);
  return { code: result.code, report: JSON.parse(stdout) as GateReport, stderr, ran };
}

/**
 * The report apart from its times, where each file's evidence came from
 * (D7, D13.2), and the estimate of the files left to run here (D17.1).
 */
export function sameApartFromSource(report: GateReport): unknown {
  const runs = report.runs.map(
    ({ from: _from, durationMs: _ms, estimate: _estimate, ...run }: GateRunReport) => run,
  );
  return { ...report, createdAt: "", runs };
}

/**
 * D17.3: the gate keeps what it runs. Each case, and each control without
 * parts, starts with no stores (review 0.1.433 S1).
 */
export function clearStores(root: string | undefined): void {
  const common = root === undefined ? null : resolveCommonDir(root);
  if (common !== null) rmSync(storePaths(common).dir, { recursive: true, force: true });
}

/** Each file below `dir` with its size and modification time. */
export function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .sort()
    .map((name) => {
      const stat = statSync(join(dir, name));
      return `${name} ${stat.size} ${stat.mtimeMs}`;
    });
}

/** The one part in `parts`, as JSON. */
export function onlyPart(parts: string): Part {
  const [name, ...more] = readdirSync(parts).filter((n) => n.startsWith(PART_PREFIX));
  if (name === undefined || more.length > 0) throw new Error(`not one part in ${parts}`);
  return JSON.parse(readFileSync(join(parts, name), "utf8")) as Part;
}

/** A new directory beside `root` holding `parts`, each as a part file; returns it. */
export function partsDir(root: string, name: string, parts: readonly unknown[]): string {
  const dir = join(dirname(root), name);
  mkdirSync(dir);
  for (const [i, part] of parts.entries()) {
    writeFileSync(join(dir, `${PART_PREFIX}${i}.json`), `${JSON.stringify(part)}\n`);
  }
  return dir;
}
