// Throwaway probe for issue #34: seeds a real store in a temp dir with failing
// known states of each validity, then prints the checkout's `squeal status`
// text and the Stop/status-hook line. Run through run.sh; needs no build.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = new URL("../../../../../../src/", import.meta.url);
const { worktreeIdFor } = await import(new URL("core/fs/index.ts", src));
const { openStore, isStoreOpenFailure } = await import(new URL("core/store/index.ts", src));
const { readStatus, formatStatus } = await import(new URL("core/status/index.ts", src));
const { knownFailuresLine } = await import(new URL("harness/shared/text.ts", src));

const scenario = process.argv[2] ?? "incident";
// With a third argument, the store is kept at that path for another CLI to read.
const keepAt = process.argv[3];
// incident: the issue's shape, every failure observed at 24 and pending at 30.
// mixed: one current failure, two pending, one stale.
const plan =
  scenario === "incident"
    ? Array.from({ length: 38 }, (_, i) => ({ name: `t${i}`, validity: "pending" }))
    : [
        { name: "current", validity: "current" },
        { name: "pendingA", validity: "pending" },
        { name: "pendingB", validity: "pending" },
        { name: "stale", validity: "stale" },
      ];

const root = keepAt ?? realpathSync(mkdtempSync(join(tmpdir(), "squeal-issue34-")));
try {
  const commonDir = join(root, ".git");
  mkdirSync(commonDir);
  writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  const id = worktreeIdFor(root);
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  store.worktrees.upsert({ id, root, commonDir, isMain: true, registeredAt: 1, daemon: null });
  store.transaction(() => {
    for (let n = 1; n <= 30; n++) {
      store.revisions.append({
        worktreeId: id,
        createdAt: n,
        head: null,
        dirty: true,
        trigger: "watch",
        changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${n}` }],
      });
    }
  });
  store.knownStates.upsertMany(
    plan.map((p) => ({
      worktreeId: id,
      check: { kind: "test", project: "", testPath: "src/a.test.ts", fullName: p.name },
      outcome: "fail",
      validity: p.validity,
      pendingPhase: p.validity === "pending" ? "queued" : null,
      observedAt: p.validity === "current" ? 30 : 24,
      commit: null,
      origin: { kind: "own" },
      durationMs: 5,
      location: null,
      summary: "AssertionError: expected 1 to be 2",
      fingerprint: "f",
    })),
  );
  const states = store.knownStates.list(id);
  store.close();

  const status = readStatus(root, { now: () => 1_000 });
  const text = formatStatus(status, 1_000);
  const lines = text.split("\n");
  console.log(`== scenario ${scenario}: seeded ${plan.length} fail states`);
  console.log("-- status --json counts:", JSON.stringify(status.counts));
  console.log("-- status --json knownFailures validities:",
    JSON.stringify(Object.groupBy(status.knownFailures, (f) => f.validity), (k, v) => (Array.isArray(v) ? v.length : v)));
  console.log("-- squeal status, first lines:");
  console.log(lines.slice(0, scenario === "incident" ? 6 : 14).join("\n"));
  console.log("-- Stop / hook status line (knownFailuresLine over fail states):");
  console.log(knownFailuresLine(states.filter((s) => s.outcome === "fail").map((s) => s.check)));
} finally {
  if (keepAt === undefined) rmSync(root, { recursive: true, force: true });
}
