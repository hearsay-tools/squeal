import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, namedText, waitLine } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { nothingRunsByItself } from "../../src/cli/status-wait-settled.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import type { AbsolutePath, EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import type { Store } from "../../src/core/types/store.js";
import { CODEX } from "../harness/codex-cli.js";
import {
  A,
  answering,
  B,
  finish,
  key,
  NOW,
  options,
  ref,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";
import { later } from "./wait-clock.js";

/*
 * Row 011-426 (gh-293; 011 C6, C15): `status --wait` says when nothing left
 * runs by itself, last on its verdict line, so a `tail -1` keeps it (row
 * 011-26). In 0.1.645 an agent waited five more times while the only files
 * not current were 98 of a `manual` group and 47 nothing queued.
 */

const BROWSER = { name: "browser", runner: "vitest", tests: [SLOW_FILE], at: "manual" };
const NOTHING = "Nothing left runs by itself; waiting again changes nothing.";
const RUN =
  " The edits affect browser test files that do not run by themselves: `squeal run browser --wait` runs them and waits for their results.";

interface Seeded {
  readonly repo: { readonly main: string; readonly mainId: string };
  readonly store: Store;
}

/** `at`'s browser group owns `SLOW_FILE`, queued; `A` pending. */
function seeded(at = "manual"): Seeded {
  const { repo, store } = repoWith([A]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ checks: [{ ...BROWSER, at }] }),
  );
  key(store, repo.mainId, SLOW_FILE, "queued");
  return { repo, store };
}

/** The edit wait over `seeded`'s worktree, the edits re-keying `rekeyed`, `A` passing after 200 ms. */
async function quiet({ repo, store }: Seeded, rekeyed: readonly string[]): Promise<EndedWait> {
  later(200, () => finish(store, repo.mainId, A));
  const sync = answering(store, repo.mainId, rekeyed).sync;
  const wait = await waitForStatus(repo.main as AbsolutePath, options(sync));
  expect(wait.outcome).toBe("quiet");
  return wait as EndedWait;
}

describe("status --wait says when nothing left runs by itself (row 011-426, gh-293)", () => {
  it("ends the verdict line with it, naming the held group's run when the edits affect its files", async () => {
    const wait = await quiet(seeded(), [A, SLOW_FILE]);
    expect(wait.edit?.onRequestGroups).toEqual(["browser"]);
    expect(nothingRunsByItself(wait.result)).toBe(true);
    const line = waitLine(wait);
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toMatch(/^Returned on quiet: /);
    expect(line).toContain("(1 on request)");
    expect(line.endsWith(`(1 on request). ${NOTHING}${RUN}`)).toBe(true);
    expect(waitLine(wait, CODEX).endsWith(RUN.replace("`squeal", `\`${CODEX}`))).toBe(true);
  });

  it("names no run when the edits affect no held file, and counts unqueued unknowns", async () => {
    const s = seeded();
    // A file nothing queued: unknown, as under a `lookup-only` baseline.
    key(s.store, s.repo.mainId, B, null);
    const wait = await quiet(s, [A]);
    expect(wait.edit?.onRequestGroups).toBeUndefined();
    expect(waitLine(wait).endsWith(`(1 on request, 1 unknown). ${NOTHING}`)).toBe(true);
  });

  it("names a commit group's run too (`heldUntilAsked`)", async () => {
    const wait = await quiet(seeded("commit"), [A, SLOW_FILE]);
    expect(waitLine(wait).endsWith(`${NOTHING}${RUN}`)).toBe(true);
  });

  it("says nothing while a file that runs by itself is queued", async () => {
    const s = seeded();
    key(s.store, s.repo.mainId, B, "queued");
    const wait = await quiet(s, [A, SLOW_FILE]);
    expect(nothingRunsByItself(wait.result)).toBe(false);
    expect(waitLine(wait)).not.toContain(NOTHING);
  });

  it("says nothing while a request runs the held file: it is queued", async () => {
    const s = seeded();
    const asks = [[testFileId(ref(SLOW_FILE)), `key-${SLOW_FILE}-queued`]] as const;
    publishNarrowAsks(s.store, s.repo.mainId, asks, NOW as EpochMs);
    const wait = await quiet(s, [A, SLOW_FILE]);
    expect(wait.result.testFilesByPhase).toEqual({ running: 0, queued: 1 });
    expect(waitLine(wait)).not.toContain(NOTHING);
  });

  it("says nothing with every file current", async () => {
    const s = seeded();
    finish(s.store, s.repo.mainId, SLOW_FILE);
    expect(waitLine(await quiet(s, [A]))).not.toContain(NOTHING);
  });

  it("is in no plain status", async () => {
    const wait = await quiet(seeded(), [A, SLOW_FILE]);
    expect(formatStatus(wait.result, NOW)).not.toContain(NOTHING);
  });
});

const synced = () => ({
  state: "synced" as const,
  revision: 4 as RevisionNumber,
  incarnation: null,
});

describe("a named status --wait whose files are all current says it too (row 011-426)", () => {
  async function named(paths: readonly string[], snapshot = false) {
    const { repo, store } = seeded();
    later(100, () => finish(store, repo.mainId, A));
    const wait = await waitForNamed(repo.main, paths, {
      timeoutMs: 3_000,
      pollMs: 20,
      settleMs: 0,
      now: () => NOW,
      sync: () => ({ current: synced, stop: () => {} }),
      ...(snapshot ? { snapshot: true } : {}),
    });
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    return namedText(wait, NOW).trimEnd().split("\n").at(-1) ?? "";
  }

  it("ends its verdict line with it, naming no run", async () => {
    const last = await named([A]);
    expect(last).toMatch(/^Named test files at revision 4: /);
    expect(last.endsWith(`(1 on request). ${NOTHING}`)).toBe(true);
  });

  it("not while it selects a held file, whose run its line already names", async () => {
    expect(await named([A, SLOW_FILE])).not.toContain(NOTHING);
  });
});
