import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { PYTHONS } from "../helpers/pytest-env.js";
import { expectAgrees, headerRevision } from "./agree.js";
import {
  type E2E,
  e2eSuite,
  OTHER_SESSION,
  PLUGINS,
  type Plugin,
  RATES,
  RESOURCES,
  until,
} from "./harness.js";

/*
 * Spec 007 Testing, end to end, and goals 1, 2, 7 and 8: the shipped
 * plugins against a repository with two pytest projects beside a Vitest
 * suite (`test/fixtures/e2e/pytest`), configured by the shipped `squeal
 * setup`, each worktree synced by its own `uv sync`. `python/small` is
 * `test/fixtures/pytest/small`, locked on pytest 9; `python/billing` is
 * locked on pytest 8, so every scenario runs both majors in one daemon.
 * Each scenario for both plugins on Python 3.10 and 3.13: an edit runs only
 * the files whose closure holds it and delivers their `PASS -> FAIL`
 * through the hooks; a synced second worktree inherits every result, those
 * whose first run observed imports the static graph misses included (016
 * D4), and an edit of such an import there runs its file; a worktree
 * without `.venv` is unknown with D2's note until its `uv sync`, then
 * inherits with zero runs; the D8 deny stops a
 * named current file once and lets a bare `pytest` run; and `squeal stop`
 * stops the daemon.
 */

const fixture = e2eSuite("pytest");

const BILLING = "python/billing";
const PROJECTS = [BILLING, "python/small"];
const INVOICE = `${BILLING}/tests/test_invoice.py`;
const TAX = `${BILLING}/tests/test_tax.py`;
const FMT = `${BILLING}/tests/test_fmt.py`;
const RESOURCES_TEST = "python/small/tests/test_resources.py";
const PYTEST_FILES = [
  INVOICE,
  TAX,
  FMT,
  "python/small/tests/test_entry_plugin.py",
  RESOURCES_TEST,
  "python/small/tests/unit/test_core.py",
];
const VITEST_FILES = ["test/math.test.ts", "test/strings.test.ts"];
/**
 * Every test plus each file's file-level check (001 D4): billing's
 * `test_invoice_total`, two `test_tax` cases and `test_money`; small's eight
 * (`test/fixtures/pytest/README.md`); Vitest's `adds`, `multiplies`, `shouts`.
 */
const CHECKS = 4 + 8 + 3 + PYTEST_FILES.length + VITEST_FILES.length;
/** Spec 007 goal 5: `small`'s edge-case file has a computed `import_module` (`test/fixtures/pytest/README.md`). */
const COMPUTED_NOTE =
  'pytest project "python/small": 1 test file(s) with an incomplete static closure, keyed by what their runs import: python/small/tests/unit/test_core.py (python/small/src/app/core.py:35: computed import)';
/** D2's note for a project without an environment: the command that creates one and what it buys (007-44). */
const noEnvironment = (project: string) =>
  `pytest project "${project}": no Python environment (looked at ${project}/.venv, ${project}/.pdm-python), so Squeal runs none of its tests and inherits none of their results. Run \`uv sync\` in ${project} to create one: Squeal then inherits the results other worktrees recorded for the same code and environment, and runs the rest.`;
/** A third session, for the worktree that starts without an environment. */
const THIRD_SESSION = "6f2a9c4e-81d3-4b7a-a0e5-3c9d2b7f1e48";

const quiet = (s: StatusSnapshot) => s.knownFailures.length === 0;
/** Exactly the checks of `paths` fail, each current, and at least one per path. */
const failingIn =
  (...paths: string[]) =>
  (s: StatusSnapshot) =>
    s.knownFailures.length > 0 &&
    s.knownFailures.every((f) => f.validity === "current" && paths.includes(f.check.testPath)) &&
    paths.every((p) => s.knownFailures.some((f) => f.check.testPath === p));

/** A main worktree whose daemon has settled a passing baseline of every check. */
async function baseline(e: E2E): Promise<StatusSnapshot> {
  const start = await e.hook("session-start", e.main);
  expect(start).toMatchObject({ code: 0, stderr: "" });
  await e.daemonReady(e.main);
  return e.settle(e.main, "a passing baseline", (s) => s.counts.current === CHECKS && quiet(s));
}

/** The test files of the runs of `root` after its first `from` runs. */
const ranSince = (e: E2E, root: string, from: number) =>
  new Set(
    e
      .runs(root)
      .slice(from)
      .flatMap((r) => r.testFiles),
  );

/**
 * Runs `body`; on a failure, prints each worktree's status and runs before
 * the fixture is removed, so a wait that timed out on CI says what it was
 * waiting on.
 */
async function withEvidence(
  e: E2E,
  roots: readonly string[],
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (error) {
    for (const root of roots) {
      const s = await e.status(root).catch((error: unknown) => String(error));
      const status =
        typeof s === "string"
          ? s
          : {
              revision: s.revision,
              daemon: s.daemon.state,
              counts: s.counts,
              withoutChecks: s.testFilesWithoutChecks,
              runnerPartPending: s.runnerPartPending,
              failures: s.knownFailures.map((f) => [
                f.check.testPath,
                f.check.kind === "test" ? f.check.fullName : "(file)",
                f.validity,
                f.summary.slice(0, 300),
              ]),
              notes: s.daemonNotes.map((n) => n.text),
            };
      console.error(`${root}: ${JSON.stringify({ status, runs: e.runs(root) })}`);
    }
    // Review 001-417: evidence never replaces the failure it describes.
    try {
      console.error(`store: ${JSON.stringify(storeEvidence(e.main))}`);
    } catch (evidence) {
      console.error(`store: no evidence: ${String(evidence)}`);
    }
    throw error;
  }
}

/** The store's pytest meta rows and each pytest run's summary (row 011-164). */
function storeEvidence(main: string): object {
  const squeal = join(main, ".git/squeal");
  const db = new DatabaseSync(join(squeal, "store.sqlite"), { readOnly: true });
  let meta: unknown[];
  try {
    meta = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'pytest%'").all();
  } finally {
    db.close();
  }
  const runs: object[] = [];
  for (const run of readdirSync(join(squeal, "runs"))) {
    const dir = join(squeal, "runs", run, "pytest");
    if (!existsSync(dir)) continue;
    for (const project of readdirSync(dir)) {
      const at = join(dir, project);
      // A run in flight made its log directory at its start and writes `run.json` at its end.
      if (!existsSync(join(at, "run.json"))) {
        runs.push({ run, project, inFlight: true });
        continue;
      }
      const json = JSON.parse(readFileSync(join(at, "run.json"), "utf8")) as {
        batches: unknown;
        report: unknown;
        notes: unknown;
      };
      const stderr = readdirSync(at).filter((f) => f.startsWith("stderr"));
      runs.push({
        run,
        project,
        report: json.report,
        notes: json.notes,
        stderr: stderr.map((f) => readFileSync(join(at, f), "utf8").slice(-1500)),
      });
    }
  }
  return { meta, runs };
}

/** Runs `command` through the plugin's PreToolUse as the agent's Bash call from `cwd`. */
const bash = (e: E2E, command: string, cwd: string) =>
  e.hook("pre-tool-use", e.main, { cwd, tool_name: "Bash", tool_input: { command } });

describe.each(PLUGINS)("pytest end to end, $name", (plugin: Plugin) => {
  describe.each(PYTHONS)("on Python %s", (python) => {
    it(`seeds both projects and delivers their transitions on ${plugin.boundary}`, async (ctx) => {
      const e = fixture(ctx, plugin, {
        python,
        amendPolicy: (p) => ({ ...p, testCommand: { denyWhenCurrent: true } }),
      });
      await withEvidence(e, [e.main], async () => {
        const config = JSON.parse(readFileSync(join(e.main, "squeal.config.json"), "utf8")) as {
          pytest: readonly object[];
        };
        const include = ["tests/**/test_*.py", "tests/**/*_test.py"];
        expect(config.pytest).toEqual([
          { name: BILLING, cwd: BILLING, include },
          { name: "python/small", cwd: "python/small", include },
        ]);

        const base = await baseline(e);
        expect(new Set(e.runs(e.main).flatMap((r) => r.testFiles))).toEqual(
          new Set([...PYTEST_FILES, ...VITEST_FILES]),
        );
        expect(base.daemonNotes.map((n) => n.text)).toEqual([COMPUTED_NOTE]);
        const registered = await e.hook("post-tool-batch", e.main);
        expect(registered.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
        expectAgrees(registered.text, await e.status(e.main));

        // Goal 1 on pytest 8: an edit two of three test files import runs and fails exactly those.
        let from = e.runs(e.main).length;
        const broken = await e.edit(e.main, "rates", RATES(25), failingIn(INVOICE, TAX));
        expect(ranSince(e, e.main, from)).toEqual(new Set([INVOICE, TAX]));
        expect(broken.knownFailures).toHaveLength(3);
        const fail = await e.hook("post-tool-batch", e.main);
        expect(fail).toMatchObject({ code: 0, stderr: "" });
        expect(fail.text).toMatch(/^SQUEAL · 3 checks changed \(3 tests\) at revision \d+\n/);
        expect(headerRevision(fail.text ?? "")).toBe(broken.revision);
        for (const name of ["test_invoice_total", "test_tax[100-20]", "test_tax[50-10]"]) {
          expect(fail.text).toContain(` > ${name}\n      PASS -> FAIL`);
        }
        expect(fail.text).not.toContain("test_fmt");
        expectAgrees(fail.text, await e.status(e.main));
        expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");

        from = e.runs(e.main).length;
        const fixed = await e.edit(e.main, "rates", RATES(), quiet);
        expect(ranSince(e, e.main, from)).toEqual(new Set([INVOICE, TAX]));
        const pass = await e.hook("post-tool-batch", e.main);
        expect(headerRevision(pass.text ?? "")).toBe(fixed.revision);
        expect(pass.text).toContain("FAIL -> PASS");
        expect(pass.text).not.toContain("FAIL  ");

        // The same on pytest 9, in the other project of the same daemon.
        from = e.runs(e.main).length;
        await e.edit(e.main, "resources", RESOURCES(2), failingIn(RESOURCES_TEST));
        expect(ranSince(e, e.main, from)).toEqual(new Set([RESOURCES_TEST]));
        const small = await e.hook("post-tool-batch", e.main);
        expect(small.text).toContain(" > test_values\n      PASS -> FAIL");
        expectAgrees(small.text, await e.status(e.main));
        await e.edit(e.main, "resources", RESOURCES(), quiet);
        await e.hook("post-tool-batch", e.main);

        // D8: a command naming a current file is denied once; a bare `pytest` runs.
        const cwd = join(e.main, BILLING);
        const deny = await bash(e, "pytest tests/test_tax.py", cwd);
        expect(deny).toMatchObject({ code: 0, stderr: "" });
        expect(deny.json?.hookSpecificOutput?.permissionDecision).toBe("deny");
        expect(deny.text).toContain(`for the 1 test file it runs (${TAX})`);
        expect(await bash(e, "pytest tests/test_tax.py", cwd)).toMatchObject({
          code: 0,
          stdout: "",
        });
        expect(await bash(e, "pytest", cwd)).toMatchObject({ code: 0, stdout: "" });

        // `squeal stop` stops the daemon.
        expect((await e.ping(e.main))?.phase).toBe("ready");
        expect((await e.cli(e.main, ["stop"])).code).toBe(0);
        expect(await e.ping(e.main)).toBeNull();
      });
    }, 600_000);

    it("inherits into synced worktrees and waits for an unsynced one", async (ctx) => {
      const e = fixture(ctx, plugin, { python });
      const roots = [e.main];
      await withEvidence(e, roots, async () => {
        const main = await baseline(e);

        // Goal 2: a second worktree with its own `uv sync` inherits every result, the files
        // whose first run observed imports the static graph cannot see included
        // (`test_core.py`'s computed import, the package `test_resources.py` opens). Since
        // 016 D4 the core stores each result under the key that holds what its run observed,
        // so none runs here; until 016-17 each ran once (status, wave 2, 007-14).
        const wt2 = e.addWorktree();
        roots.push(wt2);
        e.syncPython(wt2);
        const start = await e.hook("session-start", wt2, { session_id: OTHER_SESSION });
        expect(start.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
        await e.daemonReady(wt2);
        const second = await e.settle(
          wt2,
          "the second worktree's baseline",
          (s) => s.counts.current === CHECKS,
        );
        expect(
          e
            .runs(wt2)
            .flatMap((r) => r.testFiles)
            .sort(),
        ).toEqual([]);
        expect(second.inherited.count).toBe(main.counts.current);
        expect(second.knownFailures).toEqual([]);

        // The observed import keys its file here too (016 goal 5): an edit of it runs that file.
        let observed = e.runs(wt2).length;
        await e.edit(wt2, "resources", RESOURCES(2), failingIn(RESOURCES_TEST));
        expect(ranSince(e, wt2, observed)).toEqual(new Set([RESOURCES_TEST]));
        observed = e.runs(wt2).length;
        await e.edit(wt2, "resources", RESOURCES(), quiet);
        expect(ranSince(e, wt2, observed)).toEqual(new Set([RESOURCES_TEST]));
        await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });

        // It validates its own edits from there, on its own environment.
        const from = e.runs(wt2).length;
        const broken = await e.edit(wt2, "rates", RATES(25), failingIn(INVOICE, TAX));
        expect(ranSince(e, wt2, from)).toEqual(new Set([INVOICE, TAX]));
        const told = await e.hook("post-tool-batch", wt2, { session_id: OTHER_SESSION });
        expect(told.text).toContain("PASS -> FAIL");
        expect(headerRevision(told.text ?? "")).toBe(broken.revision);
        expect((await e.status(e.main)).knownFailures).toEqual([]);

        // D2: a worktree without `.venv` runs no pytest file and says which command creates one.
        const wt3 = e.addWorktree("wt3");
        roots.push(wt3);
        await e.hook("session-start", wt3, { session_id: THIRD_SESSION });
        await e.daemonReady(wt3);
        const unsynced = await until("the unsynced worktree's notes", 120_000, async () => {
          const s = await e.status(wt3);
          const texts = s.daemonNotes.map((n) => n.text);
          const noted = PROJECTS.every((project) => texts.includes(noEnvironment(project)));
          return noted && s.testFilesWithoutChecks.unknown === PYTEST_FILES.length ? s : null;
        });
        expect(unsynced.counts.current).toBe(VITEST_FILES.length + 3);
        expect(unsynced.knownFailures).toEqual([]);
        expect(
          e
            .runs(wt3)
            .every((r) => r.end === "crashed" || r.testFiles.every((f) => !f.endsWith(".py"))),
        ).toBe(true);

        // Synced, it resolves with zero runs: every result inherited, observed imports included.
        const before = e.runs(wt3).length;
        e.syncPython(wt3);
        const synced = await e.settle(
          wt3,
          "the synced third worktree",
          (s) => s.counts.current === CHECKS,
        );
        expect(synced.knownFailures).toEqual([]);
        expect(synced.inherited.count).toBe(CHECKS);
        // Notes are a log: each project's D2 note, then the one saying it is ready.
        const texts = synced.daemonNotes.map((n) => n.text);
        for (const project of PROJECTS) {
          const ready = texts.indexOf(
            `pytest project "${project}": its Python environment is ready`,
          );
          expect(ready).toBeGreaterThan(texts.indexOf(noEnvironment(project)));
        }
        expect(
          e
            .runs(wt3)
            .slice(before)
            .filter((r) => r.end !== "crashed"),
        ).toEqual([]);
      });
    }, 600_000);
  });
});
