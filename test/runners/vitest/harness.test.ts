import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { ReportersMap } from "vitest/node";
import type { RunnerEnvironment } from "../../../src/core/types/index.js";
import { BUILTIN_REPORTERS } from "../../../src/runners/vitest/packages.js";
import { SLOW } from "./helpers.js";

/*
 * Task 001-260 (research fresh-worktree-reuse, option 2): a daemon started
 * from Claude Code and one started from Codex, at one commit and one install,
 * compute the same environments. Vitest derives `disableColors` and its
 * default reporter from std-env's agent detection, which reads the
 * environment once per process, so each case runs the adapter in its own
 * child. `CI` changes outcomes (`allowOnly`, snapshots, `browser.*`) and
 * still keys. The equality is also the guard: a field a later Vitest derives
 * from the agent markers makes it fail.
 */

const execFileAsync = promisify(execFile);
const register = fileURLToPath(new URL("../../store/child/register-ts.mjs", import.meta.url));
const child = fileURLToPath(new URL("./child/environment.ts", import.meta.url));
const fixturesDir = resolve(import.meta.dirname, "../../fixtures/vitest");
const scratch = join(fixturesDir, ".tmp", `harness-${randomUUID()}`);

/** What std-env 4.3 reads to detect an agent or CI, removed so each case sets its own. */
const DETECTED = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "REPL_ID",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "OPENCODE",
  "AUGMENT_AGENT",
  "GOOSE_PROVIDER",
  "JUNIE_DATA",
  "JUNIE_SHIM_PATH",
  "COPILOT_AGENT",
  "COPILOT_CLI",
  "CURSOR_AGENT",
  "EDITOR",
  "TERM_PROGRAM",
  "CI",
  "GITHUB_ACTIONS",
];

interface Probe {
  readonly isAgent: boolean;
  readonly isCI: boolean;
  readonly environments: readonly RunnerEnvironment[];
}

/** The adapter's environments of the fixture copy, from a child whose env is the parent's without the markers, plus `extra`. */
async function probe(extra: Readonly<Record<string, string>>): Promise<Probe> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of DETECTED) delete env[name];
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      register,
      child,
      scratch,
    ],
    { env: { ...env, ...extra }, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Probe;
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the launching harness (001-260)", () => {
  it("leaves every environment as it is without an agent; CI still re-keys", SLOW, async () => {
    // Two projects of one config: their reporters default as the root's do not.
    mkdirSync(join(fixturesDir, ".tmp"), { recursive: true });
    cpSync(join(fixturesDir, "projects"), scratch, { recursive: true });
    const [none, claude, codex, named, ci, actions] = await Promise.all([
      probe({}),
      probe({ CLAUDECODE: "1", CLAUDE_CODE: "1" }),
      probe({ CODEX_THREAD_ID: "thread", CODEX_SANDBOX: "seatbelt" }),
      probe({ AI_AGENT: "claude" }),
      probe({ CI: "1" }),
      probe({ GITHUB_ACTIONS: "true" }),
    ]);
    expect([none, claude, codex, named, ci, actions].map((p) => [p.isAgent, p.isCI])).toEqual([
      [false, false],
      [true, false],
      [true, false],
      [true, false],
      [false, true],
      [false, true],
    ]);
    expect(none.environments.map((e) => e.project)).toEqual(["setup", "unit"]);
    expect(claude.environments).toEqual(none.environments);
    expect(codex.environments).toEqual(none.environments);
    expect(named.environments).toEqual(none.environments);
    const allowOnly = (p: Probe) =>
      p.environments.map((e) => (JSON.parse(e.resolvedConfig) as { allowOnly: boolean }).allowOnly);
    expect(allowOnly(none)).toEqual([true, true]);
    expect(allowOnly(ci)).toEqual([false, false]);
    expect(allowOnly(actions)).toEqual([false, false]);
    // `github-actions` joins the default reporters; it names no package.
    const packages = (p: Probe) => p.environments.map((e) => e.packages);
    expect(packages(ci)).toEqual(packages(none));
    expect(packages(actions)).toEqual(packages(none));
  });

  it("knows every reporter Vitest names without a package", () => {
    expect([...BUILTIN_REPORTERS].sort()).toEqual(Object.keys(ReportersMap).sort());
  });
});
