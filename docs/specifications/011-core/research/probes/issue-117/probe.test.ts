import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { git } from "../../../../../../test/hash/git-repo.js";
import { RUN_MISSING } from "../../../../../../test/helpers/baseline.js";
import { openHarness, openRepoStore } from "../../../../../../test/scheduler/helpers.js";

const record = (value: unknown) =>
  appendFileSync(join(import.meta.dirname, "evidence.jsonl"), `${JSON.stringify(value)}\n`);
const base = join(import.meta.dirname, ".scratch");
const A = "test/a.test.ts";
const B = "test/b.test.ts";
const testText = `import { test, expect } from 'vitest'; test('passes', () => expect(1).toBe(1));\n`;

for (const selected of [false, true]) {
  it(`delete ${selected ? "selected" : "queued"} test while earlier runner call is held`, async () => {
    const load = loadavg()[0];
    record({ phase: "load-check", load, cpus: cpus().length, selected });
    if (load > cpus().length) throw new Error("Probe skipped: load above CPU count");
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, "fixture-"));
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    writeFileSync(
      join(root, "vitest.config.ts"),
      `import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['test/*.test.ts'], maxWorkers: 1 } });\n`,
    );
    writeFileSync(join(root, A), testText);
    writeFileSync(join(root, B), testText);
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "initial two tracked tests"]);
    const common = join(root, ".git");
    const store = openRepoStore(common);
    const h = await openHarness(root, store, common, {
      tierSize: 1,
      policy: RUN_MISSING,
      rerunCap: 0,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const original = h.sink.states().filter((s) => s.check.testPath === B);
    expect(original.length).toBe(2);
    expect(original.every((s) => s.outcome === "pass" && s.validity === "current")).toBe(true);
    const count = h.runner.runs.length;
    let release!: () => void;
    let entered = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heldPath = selected ? B : A;
    h.runner.beforeRun = async (files) => {
      if (files.some((f) => f.path === heldPath) && !entered) {
        entered = true;
        await held;
      }
    };
    h.write(heldPath, `${testText}// rerun\n`);
    await h.batch(heldPath);
    try {
      await expect.poll(() => entered, { timeout: 10_000 }).toBe(true);
      h.remove(B);
      git(root, ["add", "-u"]);
      git(root, ["commit", "-qm", "delete tracked test"]);
      await h.batch(B);
      await delay(100);
      record({
        phase: "deletion-reconciled",
        selected,
        revision: h.scheduler.status().revision,
        keyStillPresent: h.keyOf(B) !== null,
        states: h.sink
          .states()
          .filter((s) => s.check.testPath === B)
          .map((s) => ({ outcome: s.outcome, validity: s.validity, pendingPhase: s.pendingPhase })),
      });
    } finally {
      release();
    }
    await h.scheduler.idle();
    const runs = h.runner.runs.slice(count).map((r) => ({
      files: r.files.map((f) => f.path),
      end: r.report.end,
      fileErrors: r.report.fileErrors,
      results: r.report.results,
    }));
    const history = original.flatMap((s) => store.transitions.history(h.worktreeId, s.check));
    const after = h.sink.states().filter((s) => s.check.testPath === B);
    record({ phase: "settled", selected, runs, key: h.keyOf(B), after, history });
    expect(h.keyOf(B)).toBeNull();
    expect(after).toEqual([]);
    expect(history.filter((t) => t.to === "fail")).toEqual([]);
    // Helpers close the scheduler and store after this test. The README gives cleanup.
  }, 60_000);
}
