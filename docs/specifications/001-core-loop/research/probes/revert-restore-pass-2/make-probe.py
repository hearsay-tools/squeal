#!/usr/bin/env python3
"""Probe 001-343 (throwaway): writes test/probe/rr.test.ts, a copy of the revert-restore test that logs and dumps.

Usage: python3 -I make-probe.py <scratch repo root>. $SQ_PROBE_OUT names the output directory;
$SQ_PROBE_TRUNC_MS, when set, writes the test file in two steps (empty, then its bytes) that the
watcher sees as two revisions, the second that many ms after the first's revision.
"""
import sys

root = sys.argv[1]
s = open(f"{root}/test/integration/revert-restore.test.ts").read()

def sub(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)

sub('import { afterAll, describe, expect, it } from "vitest";',
    'import { afterAll, describe, expect, it } from "vitest";\nimport { appendFileSync, readdirSync } from "node:fs";\nimport { loadavg } from "node:os";')
sub('const REPO = resolve(import.meta.dirname, "../..");',
    '''const REPO = resolve(import.meta.dirname, "../..");
// PROBE-343: one directory per repetition under $SQ_PROBE_OUT.
const OUT = join(process.env.SQ_PROBE_OUT ?? "/tmp/sq343-out", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
mkdirSync(OUT, { recursive: true });
process.env.SQ_PROBE_LOG = join(OUT, "daemon.jsonl");
const plog = (ev: string, data: Record<string, unknown> = {}) => appendFileSync(join(OUT, "probe.jsonl"), `${JSON.stringify({ t: Date.now(), ev, ...data })}\\n`);''')
# The reverting test records when it armed.
sub('''    `  rmSync(${JSON.stringify(ARM)});`,''',
    '''    `  rmSync(${JSON.stringify(ARM)});`,
    `  writeFileSync(${JSON.stringify(`${LOADED}.armed`)}, String(Date.now()));`,''')
sub('''    "  writeFileSync(file, restored);",
    `  writeFileSync(${JSON.stringify(LOADED)}, which);`,''',
    '''    "  writeFileSync(file, restored);",
    `  writeFileSync(${JSON.stringify(`${LOADED}.restored`)}, String(Date.now()));`,
    `  writeFileSync(${JSON.stringify(LOADED)}, which);`,''')
sub('''      writeFileSync(join(root, "test/reverting.test.ts"), reverting(attempt));
      await settle(root, at);''',
    '''      plog("write", { attempt, at });
      const truncMs = process.env.SQ_PROBE_TRUNC_MS;
      if (process.env.SQ_PROBE_GATE === "1" && attempt === 1) {
        // PROBE-343, route A made deterministic: the truncation's run waits in the setup file
        // until the bytes and their own revision landed, then loads the test file.
        writeFileSync(GATE, "");
        writeFileSync(join(root, "test/reverting.test.ts"), "");
        await until("the truncation's run to wait", SETTLE_MS, async () => (existsSync(WAITING) ? true : null));
        writeFileSync(join(root, "test/reverting.test.ts"), reverting(attempt));
        await until("the bytes' revision", SETTLE_MS, async () => (status(root).revision > at + 1 ? true : null));
        plog("gated", { revision: status(root).revision });
        rmSync(GATE);
      } else if (truncMs !== undefined && attempt <= Number(process.env.SQ_PROBE_TRUNC_ATTEMPTS ?? ATTEMPTS)) {
        // PROBE-343: the watcher sees one write of the test file as two revisions.
        writeFileSync(join(root, "test/reverting.test.ts"), "");
        await until("the truncation's revision", SETTLE_MS, async () => (status(root).revision > at ? true : null));
        await new Promise((r) => setTimeout(r, Number(truncMs)));
      }
      writeFileSync(join(root, "test/reverting.test.ts"), reverting(attempt));
      plog("written", { attempt });
      await settle(root, at);''')
# $SQ_PROBE_GATE=1: a setup file holds each worker while GATE exists, and says so in WAITING.
sub('''const LOADED = join(markers, "loaded");''',
    '''const LOADED = join(markers, "loaded");
const GATE = join(markers, "gate");
const WAITING = join(markers, "waiting");''')
sub('''  "src/mod.ts": NEW,
  "test/reverting.test.ts": reverting(0),''',
    '''  "src/mod.ts": NEW,
  "test/reverting.test.ts": reverting(0),
  ...(process.env.SQ_PROBE_GATE === "1"
    ? {
        "vitest.config.ts": `import { defineConfig } from "vitest/config";\\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], setupFiles: ["probe-setup.ts"] } });\\n`,
        "probe-setup.ts": [
          'import { existsSync, writeFileSync } from "node:fs";',
          'import { setTimeout as delay } from "node:timers/promises";',
          `if (existsSync(${JSON.stringify(GATE)})) {`,
          `  writeFileSync(${JSON.stringify(WAITING)}, "");`,
          `  while (existsSync(${JSON.stringify(GATE)})) await delay(20);`,
          "}",
          "",
        ].join("\\n"),
      }
    : {}),''')
import re
loop_end = re.compile(r"\n    \}\n    expect\(\s*planted,")
mt = loop_end.search(s)
assert mt and len(loop_end.findall(s)) == 1
s = s[:mt.start()] + '''
      const stamp = (f: string) => (existsSync(f) ? Number(readFileSync(f, "utf8")) : null);
      plog("attempt", { attempt, at, loaded, planted, armedAt: stamp(`${LOADED}.armed`), restoredAt: stamp(`${LOADED}.restored`), load: loadavg() });
      rmSync(`${LOADED}.armed`, { force: true });
      rmSync(`${LOADED}.restored`, { force: true });''' + s[mt.start():]
mt = loop_end.search(s)
s = s[:mt.start() + len("\n    }\n")] + '''    // PROBE-343: the store as line 195 reads it, before any assertion.
    const dump = {
      revisions: query(root, "SELECT number, created_at, trigger, changes FROM revisions WHERE worktree_id = ? ORDER BY number"),
      runs: query(root, "SELECT id, revision, test_files, started_at, ended_at, end_state FROM runs WHERE worktree_id = ? ORDER BY started_at"),
      results: query(root, "SELECT c.test_path, c.full_name, r.key, r.outcome, r.revision, r.run_id, r.recorded_at FROM results r JOIN checks c ON c.id = r.check_id WHERE r.worktree_id = ? ORDER BY r.recorded_at"),
      state: stateOf(root, "test/reverting.test.ts"),
    };
    writeFileSync(join(OUT, "dump.json"), JSON.stringify(dump, null, 1));
    const bad = planted && dump.state.includes("current pass");
    appendFileSync(join(OUT, "..", "summary.jsonl"), `${JSON.stringify({ id: OUT, planted, state: dump.state, bad, load: loadavg() })}\\n`);
''' + s[mt.start() + len("\n    }\n"):]
s = "// PROBE-343 (throwaway): generated by make-probe.py from test/integration/revert-restore.test.ts.\n" + s
import os
os.makedirs(f"{root}/test/probe", exist_ok=True)
open(f"{root}/test/probe/rr.test.ts", "w").write(s)
print("wrote", f"{root}/test/probe/rr.test.ts")
