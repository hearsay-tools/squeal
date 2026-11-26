import { describe, expect, it } from "vitest";
import { recordRunRemote } from "../../src/core/retry/remote.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { formatWhy } from "../../src/core/status/format-why.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { readWhy } from "../../src/core/status/why.js";
import { NOW, seededFailure } from "../retry/load-retry-fixture.js";
import { result } from "../store/helpers.js";
import { appendRevisions, check } from "./helpers.js";
import { reportOf } from "./why-seed.js";

/*
 * Row 026-28 (spec 026 D12 with spec 001 D6): a failure a remote machine
 * produced names it in `squeal status`, in `squeal why`'s recorded facts
 * and in its result history, also where another worktree inherits it. A
 * failure that ran here, though its run ran other files remotely, reads
 * byte for byte as before.
 */

const VM = "agent37:eu:vm:l1l8w0bsw8";
const LOCAL_FACTS =
  "recorded just now in this worktree at revision 4, load per CPU then not recorded; no retry asked at these inputs";

function statusText(root: string): string {
  const status = readStatus(root, { now: () => NOW });
  if (!status.available) throw new Error("status unavailable");
  return formatStatus(status, NOW);
}

describe("squeal status: a remote's failure names it (row 026-28)", () => {
  it("names the remote in the known failure's facts", () => {
    const { repo, store, testFile } = seededFailure();
    recordRunRemote(store, "run-1", testFile, VM);
    const status = readStatus(repo.main, { now: () => NOW });
    expect(status.available && status.knownFailures[0]?.recorded?.remote).toBe(VM);
    expect(statusText(repo.main)).toContain(
      `        recorded just now on remote ${VM} in this worktree at revision 4, load per CPU then not recorded; no retry asked at these inputs\n`,
    );
  });

  it("keeps a failure here word for word, though another file of its run ran remotely", () => {
    const { repo, store } = seededFailure();
    recordRunRemote(store, "run-1", { project: "", path: "src/other.test.ts" }, VM);
    const status = readStatus(repo.main, { now: () => NOW });
    expect(status.available && status.knownFailures[0]?.recorded).not.toHaveProperty("remote");
    const text = statusText(repo.main);
    expect(text).toContain(`        ${LOCAL_FACTS}\n`);
    expect(text).not.toContain("remote");
  });

  it("names the remote where another worktree inherits the failure", () => {
    const { repo, store, testFile } = seededFailure();
    recordRunRemote(store, "run-1", testFile, VM);
    const b = inheritingWorktree(repo, store);
    expect(statusText(b.root)).toContain(
      `recorded just now on remote ${VM} in ${repo.main} at revision 4, load per CPU then not recorded;`,
    );
    const why = formatWhy(reportOf(readWhy(b.root, NAME)), "squeal", { now: NOW });
    expect(why).toContain(`  Recorded just now on remote ${VM} in ${repo.main} at revision 4,`);
    expect(why).toContain(`        run run-1, remote ${VM}, `);
  });
});

const NAME = "src/auth.test.ts > auth > login";

describe("squeal why: a remote's failure names it (row 026-28)", () => {
  it("names the remote in the recorded facts and in the result's history entry", () => {
    const { repo, store, testFile } = seededFailure();
    recordRunRemote(store, "run-1", testFile, VM);
    const why = reportOf(readWhy(repo.main, NAME));
    expect(why.recorded?.remote).toBe(VM);
    expect(why.results.map((entry) => entry.remote)).toEqual([VM]);
    const text = formatWhy(why, "squeal", { now: NOW });
    expect(text).toContain(`\n  Recorded just now on remote ${VM} in this worktree at revision 4,`);
    expect(text).toContain(`\n        run run-1, remote ${VM}, `);
  });

  it("keeps a result here word for word", () => {
    const { repo } = seededFailure();
    const why = reportOf(readWhy(repo.main, NAME));
    expect(why.recorded).not.toHaveProperty("remote");
    expect(why.results[0]).not.toHaveProperty("remote");
    const text = formatWhy(why, "squeal", { now: NOW });
    expect(text).toContain(`\n  ${LOCAL_FACTS[0]?.toUpperCase()}${LOCAL_FACTS.slice(1)}\n`);
    expect(text).toMatch(/\n {8}run run-1, \d+ ms, key /);
    expect(text).not.toContain("remote");
  });
});

/*
 * Spec 027 D7.3 (review 0.1.644 N2): a failure a managed container produced
 * keeps `container <target>` as its remote and reads `in container <target>`.
 */
describe("a managed container's failure names it (review 0.1.644 N2)", () => {
  it("reads in container <target> in status and why", () => {
    const { repo, store, testFile } = seededFailure();
    recordRunRemote(store, "run-1", testFile, "container backend");
    expect(statusText(repo.main)).toContain(
      "        recorded just now in container backend in this worktree at revision 4, load per CPU then not recorded; no retry asked at these inputs\n",
    );
    const text = formatWhy(reportOf(readWhy(repo.main, NAME)), "squeal", { now: NOW });
    expect(text).toContain(
      "\n  Recorded just now in container backend in this worktree at revision 4,",
    );
    expect(text).toContain("\n        run run-1, in container backend, ");
    expect(text).not.toContain("remote");
  });
});

/** Worktree `b`, whose own failure gives way to main's identical one it inherits. */
function inheritingWorktree(
  repo: ReturnType<typeof seededFailure>["repo"],
  store: ReturnType<typeof seededFailure>["store"],
) {
  const b = repo.addWorktree("b");
  store.worktrees.upsert({
    id: b.id,
    root: b.root,
    commonDir: repo.commonDir,
    isMain: false,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, b.id, 1, { head: null, dirty: true, createdAt: 1 });
  store.testFileKeys.upsertMany([
    {
      worktreeId: b.id,
      testFile: { project: "", path: "src/auth.test.ts" },
      key: "k1",
      revision: 1,
      pending: null,
    },
  ]);
  const login = check("src/auth.test.ts", "auth > login");
  const produced = store.results.listForCheck(login, 1)[0];
  if (produced === undefined) throw new Error("no stored failure");
  const sink = createStateSink(store);
  const own = result(login, "k1", { outcome: "fail", worktreeId: b.id, runId: "run-b" });
  store.results.putMany([own]);
  sink.applyResults(b.id, 1, [own], { checkpointId: null });
  store.results.putMany([produced]);
  sink.refresh(b.id, 1, { checkpointId: null });
  expect(store.knownStates.get(b.id, login)?.origin?.kind).toBe("inherited");
  return b;
}
