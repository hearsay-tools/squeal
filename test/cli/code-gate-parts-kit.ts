import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { codeGateCommand } from "../../src/cli/code-gate.js";
import type { GateAdapters } from "../../src/core/code/gate/collect.js";
import type { GateReport, GateRunReport } from "../../src/core/code/gate/report.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { committed, scratch, writeFiles } from "../ci/fixture.js";
import { ADAPTERS } from "../code/gate/collect-fixture.js";
import { MATH_FILES, recordCovered } from "../runners/vitest/ci-coverage-kit.js";

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

export interface Recorded {
  readonly root: string;
  /** The directory `ci record` wrote its part into. */
  readonly parts: string;
}

/**
 * The fixture, with `files` written over `MATH_FILES` before the commit
 * and `edits` written after it, and `ci record`'s parts of the working tree.
 */
export async function recorded(
  files: Readonly<Record<string, string>> = {},
  edits: Readonly<Record<string, string>> = {},
): Promise<Recorded> {
  const root = committed(scratch("gate-parts"), { ...BASE, ...files });
  writeFiles(root, { "src/math.ts": MATH_FILES["src/math.ts"] as string, ...edits });
  const parts = join(dirname(root), "parts");
  const run = await recordCovered(root, parts);
  if (run.parts.length !== 1) throw new Error(`ci record wrote no part: ${run.said}`);
  return { root, parts };
}

/** The adapters, each Vitest run's files appended to `ran`. */
function watched(ran: string[]): GateAdapters {
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return (files: readonly TestFileRef[], ...rest: unknown[]) => {
          ran.push(...files.map((f) => f.path));
          return (value as (...args: unknown[]) => unknown).call(target, files, ...rest);
        };
      },
    });
  return { ...ADAPTERS, vitest: async (options) => wrap(await ADAPTERS.vitest(options)) };
}

export interface Gated {
  readonly code: number;
  readonly report: GateReport;
  readonly stderr: string;
  /** The test files the gate ran. */
  readonly ran: readonly string[];
}

/** `squeal code --base HEAD <args> --json` in `root`. */
export async function gate(root: string, args: readonly string[] = []): Promise<Gated> {
  const ran: string[] = [];
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: (text: string) => {
      stdout += text;
    },
    stderr: (text: string) => {
      stderr += text;
    },
    cwd: root,
    env: {},
  };
  const code = await codeGateCommand(["--base", "HEAD", ...args, "--json"], io, watched(ran));
  if (stdout === "") throw new Error(`squeal code exited ${code}: ${stderr}`);
  return { code, report: JSON.parse(stdout) as GateReport, stderr, ran };
}

/** The report apart from its times and where each file's evidence came from (D7, D13.2). */
export function sameApartFromSource(report: GateReport): unknown {
  const runs = report.runs.map(({ from: _from, durationMs: _ms, ...run }: GateRunReport) => run);
  return { ...report, createdAt: "", runs };
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
