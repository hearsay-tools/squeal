import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect } from "vitest";
import type {
  LintFileResult,
  LintRefresh,
  LintRunReport,
  LintSnapshot,
} from "../../../src/core/lint/provider/index.js";
import { cli, FIXTURES, type Major, onDisk, project, provider } from "./helpers.js";
import { Replay, SOURCES } from "./schedule.js";

/*
 * Spec 017 goal 5: over research 017-01's 200-edit replay, every result the
 * provider gives equals a fresh `eslint` CLI run on the same bytes. A fresh
 * CLI costs about 2.3 s of CPU per step here, so each step's CLI result is
 * recorded once (`SQUEAL_LINT_RECORD=1`) with a hash of the project's bytes;
 * a routine run compares every step with the recording and runs the CLI
 * live on `LIVE` steps (the coordinator's call, 2026-10-26).
 */

const RECORD = process.env.SQUEAL_LINT_RECORD === "1";
export const RECORD_COMMAND = (major: Major) =>
  `SQUEAL_LINT_RECORD=1 npx vitest run test/lint/provider/replay-eslint${major}.test.ts`;
/** A local rule's code (thread), a typed program file, a new nested config (instance). */
const LIVE = [53, 133, 181];
const STEPS = 200;

type Tuple = readonly [
  rule: string | null,
  message: string,
  severity: string,
  line: number,
  column: number,
];
type Results = Readonly<Record<string, readonly Tuple[] | string>>;

interface Recording {
  readonly versions: Readonly<Record<string, string>>;
  readonly steps: readonly {
    readonly what: string;
    readonly bytes: string;
    readonly results: Results;
  }[];
}

export async function replay(major: Major): Promise<void> {
  const root = project("project", major);
  const file = join(FIXTURES, `replay-eslint${major}.json`);
  const versions = versionsOf(root);
  const recorded = RECORD ? null : (JSON.parse(readFileSync(file, "utf8")) as Recording);
  const stale = `the recording is out of date: ${RECORD_COMMAND(major)}`;
  if (recorded !== null) expect(recorded.versions, stale).toEqual(versions);

  const eslint = provider(root);
  expect(await eslint.open()).toHaveProperty("toolVersion", versions.eslint);
  let snapshot = (await eslint.refresh("none")) as LintSnapshot;
  const schedule = new Replay(root);
  const steps: Recording["steps"][number][] = [];
  const mismatches: string[] = [];
  try {
    for (let i = 0; i < STEPS; i++) {
      const step = schedule.step(i);
      const level = levelOf(root, step.changed, snapshot);
      if (level !== "none") snapshot = (await eslint.refresh(level)) as LintSnapshot;
      const inputs = await eslint.inputs(SOURCES);
      const changed = step.changed.filter((p) => inputs.has(p));
      const order = [...changed, ...SOURCES.filter((p) => inputs.has(p) && !changed.includes(p))];
      const got = tuples(root, (await eslint.lint(onDisk(root, order))) as LintRunReport);
      const bytes = bytesOf(root);
      const truth = recorded?.steps[i]?.results ?? tuples(root, { results: cli(root, SOURCES) });
      if (recorded !== null) {
        expect(recorded.steps[i]?.bytes, `step ${i}: ${stale}`).toBe(bytes);
        if (LIVE.includes(i)) {
          expect(tuples(root, { results: cli(root, SOURCES) }), `step ${i}`).toEqual(truth);
        }
      }
      for (const path of SOURCES) {
        const expected = inputs.has(path) ? truth[path] : ignored(truth[path]);
        const actual = inputs.has(path) ? got[path] : "ignored";
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          mismatches.push(
            `step ${i} (${step.what}, ${level}) ${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
          );
        }
      }
      steps.push({ what: step.what, bytes, results: truth });
    }
  } finally {
    schedule.finish();
  }
  expect(mismatches).toEqual([]);
  if (RECORD) {
    const lines = steps.map((s) => `    ${JSON.stringify(s)}`).join(",\n");
    writeFileSync(
      file,
      `{\n  "versions": ${JSON.stringify(versions)},\n  "steps": [\n${lines}\n  ]\n}\n`,
    );
  }
}

/** Spec 017 D4, as the pass decides it: a config file, then anything the config loaded. */
function levelOf(root: string, changed: readonly string[], snapshot: LintSnapshot): LintRefresh {
  let level: LintRefresh = "none";
  for (const path of changed) {
    if (/(^|\/)eslint\.config\.[cm]?[jt]s$/.test(path)) level = "instance";
    else if (snapshot.closure.includes(path)) return "thread";
    else if (path.startsWith("node_modules/")) {
      const real = realpathSync(join(root, path));
      if (snapshot.packages.some((p) => real.startsWith(`${p}/`))) return "thread";
    }
  }
  return level;
}

/** Each file's findings as tuples, the project root written `<root>`, as a temp folder differs per run. */
function tuples(
  root: string,
  report: { readonly results: ReadonlyMap<string, LintFileResult> },
): Results {
  const rootless = (text: string) =>
    text.split(realpathSync(root)).join("<root>").split(root).join("<root>");
  const out: Record<string, readonly Tuple[] | string> = {};
  for (const [path, result] of report.results) {
    out[path] =
      "unknown" in result
        ? `unknown: ${rootless(result.unknown)}`
        : result.findings.map((f) => [
            f.rule ?? null,
            rootless(f.message),
            f.severity,
            f.line,
            f.column,
          ]);
  }
  return out;
}

/** The CLI's result for a file it was named and ignores, as `ignored`. */
function ignored(result: readonly Tuple[] | string | undefined): string {
  const only = typeof result === "string" ? undefined : result?.[0];
  return result?.length === 1 && only?.[1].startsWith("File ignored")
    ? "ignored"
    : JSON.stringify(result);
}

/** A hash of every project file, the linked tools left out: the bytes a step's CLI result holds for. */
function bytesOf(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        hash.update(`${relative(root, path)}\0${readFileSync(path, "utf8")}\0`);
    }
  };
  walk(root);
  return hash.digest("hex").slice(0, 16);
}

function versionsOf(root: string): Record<string, string> {
  const version = (path: string) =>
    String(
      JSON.parse(readFileSync(join(root, "node_modules", path, "package.json"), "utf8")).version,
    );
  return {
    eslint: version("eslint"),
    "typescript-eslint": version("typescript-eslint"),
    typescript: version("typescript"),
  };
}
