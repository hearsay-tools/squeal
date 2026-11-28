/*
 * Throwaway probe, row 011-439 (wave 132). What Claude Code's session-start and post-tool-batch
 * hooks print while another connection holds the store's write lock for longer than the hooks'
 * busy timeout (STATUS_BUSY_TIMEOUT_MS, 1 s), as a daemon's long write would; and whether the
 * PASS -> FAIL the busy call did not print is printed by the next call. With SQUEAL_HOOK_DEBUG=1
 * the hook names the error it swallowed. Prints a table; asserts nothing but the setup.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, expect, it } from "vitest";
import { storePaths } from "../../../../../../../src/core/store/paths.js";
import { STATUS_BUSY_TIMEOUT_MS } from "../../../../../../../src/core/status/open.js";
import { runHook } from "../../../../../../../src/harness/claude-code/hooks.js";
import type { HookDeps } from "../../../../../../../src/harness/shared/hook.js";
import { hookText, recorded, squealRepo } from "../../../../../../../test/harness/helpers.js";

const deps = (): HookDeps => ({ env: { SQUEAL_HOOK_DEBUG: "1" }, ensureDaemon: async () => "alive" });
const rows: string[] = [];
afterAll(() => writeFileSync(join(import.meta.dirname, "output.txt"), `${rows.join("\n")}\n`));

/** One hook call; with `holdMs`, a second connection holds the write lock from before the call for that long. */
async function call(name: "session-start" | "post-tool-batch", root: string, db: string, holdMs: number, session: string) {
  const holder = new DatabaseSync(db);
  if (holdMs > 0) holder.exec("BEGIN IMMEDIATE");
  const release = setTimeout(() => holder.isTransaction && holder.exec("ROLLBACK"), holdMs);
  const started = performance.now();
  try {
    const out = await runHook(name, recorded(name, root, { session_id: session }), deps());
    const ms = Math.round(performance.now() - started);
    const text = hookText(out);
    rows.push(`${name} | lock held ${holdMs} ms | ${ms} ms | stdout ${JSON.stringify(text.slice(0, 60))} | stderr ${JSON.stringify(out.stderr.trim())}`);
    return text;
  } finally {
    clearTimeout(release);
    if (holder.isTransaction) holder.exec("ROLLBACK");
    holder.close();
  }
}

it("session-start and post-tool-batch on a store busy past the hook's timeout", async () => {
  rows.push(`STATUS_BUSY_TIMEOUT_MS = ${STATUS_BUSY_TIMEOUT_MS}`);
  const r = squealRepo();
  const db = storePaths(r.repo.commonDir).database;
  r.apply(r.pass());
  // A free store: the registration line.
  expect(await call("session-start", r.root, db, 0, "free")).toMatch(/^SQUEAL · registered/);
  // A busy store: a second session registers while the lock is held for 3 s (the hook gives up at 1 s).
  await call("session-start", r.root, db, 3_000, "busy");
  // The same session once the lock is gone.
  await call("session-start", r.root, db, 0, "busy");
  // A PASS -> FAIL owed to session "free": the post-tool-batch while busy, then the next one.
  r.apply(r.fail());
  await call("post-tool-batch", r.root, db, 3_000, "free");
  const next = await call("post-tool-batch", r.root, db, 0, "free");
  rows.push(`next post-tool-batch carries PASS -> FAIL: ${next.includes("PASS -> FAIL")}`);
  // A session whose only session-start met the busy store: its first post-tool-batch on a free store.
  await call("session-start", r.root, db, 3_000, "late");
  const first = await call("post-tool-batch", r.root, db, 0, "late");
  rows.push(`late session's first post-tool-batch registers it: ${first.startsWith("SQUEAL · registered")}`);
}, 60_000);
