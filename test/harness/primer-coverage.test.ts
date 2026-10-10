import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PolicyFile, TestFileRef } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { codexCommand } from "../../src/harness/codex/command.js";
import { runCodexHook } from "../../src/harness/codex/index.js";
import { CONTEXT_CAP_CHARS, capContext } from "../../src/harness/codex/output.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER, PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { setKey } from "../state/helpers.js";
import { codexRecorded } from "./codex/helpers.js";
import { FILE, recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Task 001-234: the primer lists what Squeal covers, read from
 * `squeal.config.json` and the test files the runner listed, then says
 * typecheck, build and any other test suite are not covered, so the agent
 * can work out what is left (005's pilot: every false "pass" came from an
 * uncovered node:test suite). The same structure with and without slow
 * files and under both harnesses; within `PRIMER_CAP_CHARS`, however long
 * the list. Spec 004 D8, D9: with slow files it also says when they run and
 * when a slow failure arrives, which differs by harness.
 */

const NOT_COVERED =
  "Squeal does not cover typecheck, build or any other test suite: run those yourself.";
const CODEX = codexCommand(
  { PLUGIN_ROOT: "/home/someone/.codex/plugins/cache/squeal/squeal/0.1.107" },
  "/unused.mjs",
);
const deps: HookDeps = { env: {}, ensureDaemon: async () => "alive" };

interface Case {
  readonly policy: PolicyFile;
  /** Test files the runner listed beside `FILE`, or in its place with `replace`. */
  readonly files: readonly TestFileRef[];
  readonly replace?: boolean;
  readonly covers: string;
  readonly nodeTest: boolean;
  readonly slow: boolean;
}

const SCRIPTS = { name: "scripts", argv: [], env: {}, include: ["scripts/*.test.mjs"] };
const E2E = { name: "e2e", cwd: "e2e", argv: [], env: {}, include: ["**/*.test.mjs"], slow: true };

const MATRIX: Record<string, Case> = {
  "Vitest only": {
    policy: {},
    files: [],
    covers: "Squeal covers Vitest (vitest.config.ts).",
    nodeTest: false,
    slow: false,
  },
  "Vitest and node:test": {
    policy: { nodeTest: [SCRIPTS] },
    files: [{ project: "scripts", path: "scripts/changelog.test.mjs" }],
    covers:
      'Squeal covers Vitest (vitest.config.ts) and node:test project "scripts" (scripts/*.test.mjs).',
    nodeTest: true,
    slow: false,
  },
  "Vitest and slow files": {
    policy: { slow: { include: ["test/slow/**/*.test.ts"] } },
    files: [
      { project: "", path: "test/slow/ledger.test.ts" },
      { project: "", path: "test/slow/import.test.ts" },
    ],
    covers: "Squeal covers Vitest (vitest.config.ts), with 2 slow test files.",
    nodeTest: false,
    slow: true,
  },
  "all three, with Vitest projects": {
    policy: { nodeTest: [SCRIPTS, E2E], slow: { include: ["test/slow/**/*.test.ts"] } },
    replace: true,
    files: [
      { project: "unit", path: "src/math.test.ts" },
      { project: "browser", path: "test/slow/ledger.test.ts" },
      { project: "scripts", path: "scripts/changelog.test.mjs" },
      { project: "e2e", path: "e2e/flow.test.mjs" },
    ],
    covers:
      'Squeal covers Vitest (vitest.config.ts, projects "browser" and "unit") and node:test projects "scripts" (scripts/*.test.mjs) and "e2e" (e2e/**/*.test.mjs), with 2 slow test files.',
    nodeTest: true,
    slow: true,
  },
};

function repoFor(c: Pick<Case, "policy" | "files" | "replace">): SquealRepo {
  const r = squealRepo();
  r.apply(r.pass());
  r.policy(c.policy);
  writeFileSync(join(r.root, "vitest.config.ts"), "export default {};\n");
  if (c.replace === true) r.store.testFileKeys.remove(r.worktreeId, [FILE]);
  c.files.forEach((file, i) => {
    setKey(r.store, `k-extra-${i}`, { file, worktreeId: r.worktreeId });
  });
  return r;
}

/** The hook's additionalContext, and the primer: its last paragraph. */
function primerOf(stdout: string): { context: string; primer: string } {
  const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
  const context = parsed.hookSpecificOutput.additionalContext;
  return { context, primer: context.slice(context.lastIndexOf("\n\n") + 2) };
}

async function sessionStart(r: SquealRepo, harness: "claude-code" | "codex"): Promise<string> {
  const out =
    harness === "claude-code"
      ? await runHook("session-start", recorded("session-start", r.root), deps)
      : await runCodexHook("session-start", codexRecorded("exec", "session-start", r.root), {
          ...deps,
          command: CODEX,
        });
  return out.stdout;
}

const runs = Object.keys(MATRIX).flatMap((name) =>
  (["claude-code", "codex"] as const).map((harness) => [name, harness] as const),
);

describe("SessionStart's primer lists exactly what the policy and the runner cover (001-234)", () => {
  it.each(runs)("%s, under %s", async (name, harness) => {
    const c = MATRIX[name] as Case;
    const text = primerOf(await sessionStart(repoFor(c), harness)).primer;
    const command = harness === "claude-code" ? "squeal" : CODEX;
    expect(text.startsWith("Squeal runs this repository's ")).toBe(true);
    expect(text).toContain(
      c.nodeTest
        ? "Vitest and node:test tests in the background"
        : "Vitest tests in the background",
    );
    // The list, then what is left, as the primer's last two sentences.
    expect(text.endsWith(` ${c.covers} ${NOT_COVERED}`)).toBe(true);
    expect(text.match(/Squeal covers /g)).toHaveLength(1);
    expect(text.includes(`on \`${command} run --slow\``)).toBe(c.slow);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("says the slow files are not counted while the runner has listed no test file", async () => {
    const r = repoFor({
      policy: { slow: { include: ["test/slow/**"] } },
      files: [],
      replace: true,
    });
    const text = primerOf(await sessionStart(r, "claude-code")).primer;
    expect(text).toContain(
      `Squeal covers Vitest (vitest.config.ts), with slow test files not counted yet. ${NOT_COVERED}`,
    );
  });
});

describe("a long coverage list (001-234)", () => {
  const many = Array.from({ length: 40 }, (_, i) => `suite-${String(i).padStart(2, "0")}`);
  const policy: PolicyFile = {
    nodeTest: many.map((name) => ({
      name,
      argv: [],
      env: {},
      include: [`packages/${name}/test/**/*.test.mjs`, `packages/${name}/scripts/*.test.mjs`],
    })),
  };
  const files = many.map((name) => ({ project: `web-${name}`, path: `web/${name}.test.ts` }));

  it.each(["claude-code", "codex"] as const)(
    "folds projects into 'and N more' and keeps the not-covered sentence whole, under %s",
    async (harness) => {
      const out = primerOf(await sessionStart(repoFor({ policy, files, replace: true }), harness));
      expect(out.primer.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(out.primer.endsWith(NOT_COVERED)).toBe(true);
      expect(out.primer).toMatch(
        /Squeal covers Vitest \(vitest\.config\.ts, projects "web-suite-00"/,
      );
      expect(out.primer).toMatch(/ and \d+ more\) and node:test projects "suite-00" \(/);
      expect(out.primer).toMatch(/ and \d+ more\. Squeal does not cover/);
    },
  );

  it("keeps the folded primer whole when a Codex hook cuts a long text", async () => {
    const out = primerOf(
      await sessionStart(repoFor({ policy, files, replace: true }), "codex"),
    ).primer;
    const text = `${Array.from({ length: 600 }, (_, i) => `FAIL  check ${i}`).join("\n")}\n\n${out}`;
    const capped = capContext(text, CODEX);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(`\n\n${out}`)).toBe(true);
  });
});

describe("the slow sentence by harness (spec 004 D8, D9)", () => {
  const slow = { vitestConfig: null, vitestProjects: [], nodeTest: [], slow: { files: 3 } };

  it("is absent without slow files, under both harnesses", () => {
    for (const command of ["squeal", CODEX]) expect(primer(command)).not.toMatch(/slow/i);
    expect(PRIMER).toContain(`Squeal covers Vitest. ${NOT_COVERED}`);
  });

  it("under Claude Code, names when slow suites run and the idle wake", () => {
    const text = primer("squeal", slow);
    expect(text).toContain(
      "Slow test suites run when you pause between turns or on `squeal run --slow`, never during Stop's wait;",
    );
    expect(text).toContain("a slow failure wakes you when you are idle in an interactive session");
  });

  it("under Codex, says a slow failure arrives with the next prompt or tool call", () => {
    const text = primer(CODEX, slow);
    expect(text).toContain(`on \`${CODEX} run --slow\``);
    expect(text).toContain("a slow failure arrives with your next prompt or tool call.");
    expect(text).not.toContain("wakes you");
  });
});
