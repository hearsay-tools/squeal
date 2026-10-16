import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { formatDelta } from "../../../../../../src/core/delivery/index.js";
import { readDaemonNotes } from "../../../../../../src/core/notes.js";
import { SUMMARY_MAX_CHARS } from "../../../../../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../../../../../src/core/status/index.js";
import { createRepo, scheduledRuns } from "../../../../../../test/integration/stamps-repo.js";
import { touchHeard } from "../../../../../../test/integration/touched-repo.js";
import { openHarness, openRepoStore, SLOW } from "../../../../../../test/scheduler/helpers.js";

// Throwaway probe for research/issue-13.md. Not product code.
// Scheduler reproduction: the real scheduler, Vitest adapter, store and
// delivery (test/scheduler/helpers.ts). The watch batch is handed over by the
// harness as the change feed would; no watcher, daemon or hook runs, and the
// originating cezarion run is not replayed.
//
// Two tests pass. Then a source edit re-runs them; `test/holds.test.ts` holds
// its run while N committed `dist/*.d.ts` files, which no test imports, are
// rewritten with their own bytes (a build that reproduces its output), and
// the batch of those paths reaches the scheduler.

const N = Number(process.env.ISSUE13_PATHS ?? 600);
const artifact = (i: number) => `dist/agent-config/module-${i}.d.ts`;
const EXPLANATION = "was written during this run and ended as it was";

const holds = [
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { setTimeout as sleep } from "node:timers/promises";',
  'import { expect, it } from "vitest";',
  'import { which } from "../src/mod.ts";',
  'const at = (path: string) => new URL("../" + path, import.meta.url);',
  'it("passes", async () => {',
  '  if (existsSync(at("flags/hold"))) {',
  '    writeFileSync(at("flags/started"), "");',
  '    for (let i = 0; i < 600 && !existsSync(at("flags/heard")); i++) await sleep(50);',
  "  }",
  '  expect(which).toBe("old");',
  "});",
  "",
].join("\n");

const files: Record<string, string> = {
  ".gitignore": "node_modules/\nflags/\n",
  "package.json": `${JSON.stringify({ name: "issue13", private: true, type: "module" })}\n`,
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"] } });\n`,
  "src/mod.ts": 'export const which = "old";\n',
  "flags/.keep": "\n",
  "test/holds.test.ts": holds,
  "test/other.test.ts": 'import { it } from "vitest";\nimport "../src/mod.ts";\nit("passes", () => {});\n',
};
for (let i = 0; i < N; i++) files[artifact(i)] = `export declare const m${i}: number;\n`;

describe("issue 13, scheduler reproduction", () => {
  it(`${N} rewritten artifacts no test reads`, SLOW, async () => {
    const repo = createRepo(files);
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 4,
      runnerPartBesideRun: true,
    });
    const { delivery, consumer } = await h.consumer();
    await h.scheduler.start();
    await h.scheduler.idle();
    await delivery.onToolBoundary(consumer);
    const runs = scheduledRuns(h);

    // An edit re-keys both files; the held run hears the artifacts' touch.
    writeFileSync(join(h.root, "flags/hold"), "");
    const heard = touchHeard(h);
    h.write("src/mod.ts", 'export const which = "old"; // edited\n');
    await h.batch("src/mod.ts");
    const started = join(h.root, "flags/started");
    for (let i = 0; i < 1200 && !existsSync(started); i++) await sleep(25);
    expect(existsSync(started)).toBe(true);
    const paths = Array.from({ length: N }, (_, i) => artifact(i));
    for (const p of paths) h.write(p, readFileSync(join(h.root, p), "utf8"));
    await h.batch(...paths);
    await heard;
    writeFileSync(join(h.root, "flags/heard"), "");
    await h.scheduler.idle();

    const reasons = h.sink.callsOf("markUnknown").map((c) => c.reason);
    const notes = readDaemonNotes(h.store, h.worktreeId).map((n) => n.text);
    const d = await delivery.onToolBoundary(consumer);
    const text = d === null ? "(no delta)" : formatDelta(d);
    const status = readStatus(h.root);
    const statusText = formatStatus(status, Date.now());
    const statusLine = statusText.split("\n").find((l) => l.includes(EXPLANATION)) ?? "";

    console.log(`runs after the edit: ${runs.map((r) => r.files.map((f) => f.path).join("+")).join(" | ")}`);
    console.log(`markUnknown reasons: ${reasons.map((r) => r.length).join(", ")} chars`);
    console.log(`first reason starts: ${reasons[0]?.slice(0, 160)}`);
    console.log(`first reason ends: ${reasons[0]?.slice(-160)}`);
    console.log(`notes naming the touch: ${notes.filter((n) => n.includes("dist/")).length}`);
    console.log(`header: ${JSON.stringify(h.header().counts)}`);
    console.log(`--- delivered (${text.length} chars) ---\n${text}\n--- end ---`);
    console.log(`status: ${statusText.length} chars; reason line ${statusLine.length} chars`);
    console.log(`status head:\n${statusText.split("\n").map((l) => l.slice(0, 200)).slice(0, 14).join("\n")}`);

    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toContain(EXPLANATION);
    // The control: the explanation is delivered exactly when it ends within the
    // summary cap, which keeps `SUMMARY_MAX_CHARS - 3` characters and adds "...".
    const reason = reasons[0] ?? "";
    const fits = reason.indexOf(EXPLANATION) + EXPLANATION.length <= SUMMARY_MAX_CHARS - 3;
    console.log(`explanation delivered: ${text.includes(EXPLANATION)}; whole reason delivered: ${text.includes(reason)}`);
    expect(text.includes(EXPLANATION)).toBe(fits);
  });
});
