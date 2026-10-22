import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkIdentity, readFlakyNotes } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import { type CheckId, DEFAULT_POLICY } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { createRepo, type HarnessOptions, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 011 C5 as amended 2026-10-18 (gh-20, task 011-19;
 * `research/issue-20-reproduction.md`): a slow file whose new failure is
 * file-level, stored after every one of its tests reported `pass`, is re-run
 * forced once, as a fast file's is; a pass clears it and `why` keeps the
 * first error, a fail again is reported once. A slow file's real test
 * failure keeps today's limit: no re-run. `test/teardown.test.ts` is slow;
 * its `afterAll` throws while a marker outside the worktree exists, which
 * no key covers, as the issue's cleanup race did.
 */

const SLOW_FILE = "test/teardown.test.ts";
const fileLevel: CheckId = { kind: "file", project: "", testPath: SLOW_FILE };
const cleans: CheckId = { kind: "test", project: "", testPath: SLOW_FILE, fullName: "cleans" };

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function slowOptions(): HarnessOptions {
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-011-19-slot-"));
  cleanup.push(slotDir);
  return {
    tierSize: 4,
    policy: { slow: { ...DEFAULT_POLICY.slow, include: [SLOW_FILE], maxParallel: 1 } },
    slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
  };
}

interface Teardown {
  readonly once: boolean;
  readonly testFails?: boolean;
  /** Review wave-2b B2: the first run throws FIRST_ERROR, every later one SECOND_ERROR. */
  readonly differing?: boolean;
}

/**
 * A repository whose slow file's test passes (or, with `testFails`, fails)
 * and whose `afterAll` throws ENOTEMPTY while the marker exists; with
 * `once` the throwing run removes the marker. With `differing` it always
 * throws, a first error while the marker is empty and a second after.
 */
function teardownRepo({ once, testFails = false, differing = false }: Teardown) {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-011-19-${randomUUID()}`);
  cleanup.push(marker);
  const at = JSON.stringify(marker);
  writeFileSync(
    join(repo.main, SLOW_FILE),
    [
      'import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
      'import { afterAll, expect, it } from "vitest";',
      "",
      `it("cleans", () => expect(${testFails ? `existsSync(${at})` : "false"}).toBe(false));`,
      "",
      "afterAll(() => {",
      `  if (!existsSync(${at})) return;`,
      ...(differing
        ? [
            `  const seen = readFileSync(${at}, "utf8");`,
            `  writeFileSync(${at}, "again");`,
            '  throw new Error(seen === "" ? "FIRST_ERROR_01119" : "SECOND_ERROR_01119");',
          ]
        : [
            ...(once ? [`  rmSync(${at}, { force: true });`] : []),
            '  throw Object.assign(new Error("ENOTEMPTY, Directory not empty"), { code: "ENOTEMPTY" });',
          ]),
      "});",
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", SLOW_FILE]);
  git(repo.main, ["commit", "-qm", "teardown"]);
  writeFileSync(marker, "");
  return repo;
}

async function started(options: Teardown) {
  const repo = teardownRepo(options);
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, slowOptions());
  await h.scheduler.start();
  await h.scheduler.idle();
  return { store, h };
}

describe("a slow file's failure after its tests passed is re-run once (task 011-19)", SLOW, () => {
  it("re-runs a transient one once, clears it on pass, and `why` keeps the first error", async () => {
    const { store, h } = await started({ once: true });

    expect(h.runsOf(SLOW_FILE)).toHaveLength(2);
    expect(h.sink.stateOf(fileLevel)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(h.sink.stateOf(cleans)).toMatchObject({ outcome: "pass" });
    const history = store.transitions.history(h.worktreeId, fileLevel);
    expect(history.map((t) => t.kind)).toEqual(["first-seen-fail", "fail-to-pass"]);
    expect(history[0]?.toFingerprint).toMatch(/^Error: ENOTEMPTY, Directory not empty @ /);
    expect(readFlakyNotes(store).get(checkIdentity(fileLevel))).toMatchObject({
      from: "fail",
      to: "pass",
    });
    const why = formatWhy(readWhy(h.root, SLOW_FILE, {}));
    // Row 011-77: the FAIL the pass replaced is listed with its run, not on the flaky note's line.
    expect(why).toContain("Replaced failures (1, newest first):");
    expect(why).toContain("        error after its tests ran: ENOTEMPTY, Directory not empty\n");
    expect(why).not.toContain("the FAIL it replaced");
    expect(why).not.toContain("setup failed");
    // The replaced failure already names the first error: it is said once.
    expect(why).not.toContain("First error, before its re-run");
  });

  it("reports a persistent one after its one re-run, and never re-runs the key again", async () => {
    const { store, h } = await started({ once: false });

    expect(h.runsOf(SLOW_FILE)).toHaveLength(2);
    expect(h.sink.stateOf(fileLevel)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(store.transitions.history(h.worktreeId, fileLevel).map((t) => t.kind)).toEqual([
      "first-seen-fail",
    ]);
    await h.scheduler.requestFullSuite();
    await h.scheduler.idle();
    expect(h.runsOf(SLOW_FILE)).toHaveLength(2);
    const why = formatWhy(readWhy(h.root, SLOW_FILE, {}));
    // The re-run failed the same way: its first error is the summary, said once.
    expect(why.match(/ENOTEMPTY, Directory not empty/g)?.length).toBeGreaterThan(0);
    expect(why).not.toContain("First error, before its re-run");
    expect(why).not.toMatch(/flaky/i);
  });

  it("keeps a first error a failing re-run replaced with a different one, never calling it flaky (review wave-2b B2)", async () => {
    const { store, h } = await started({ once: false, differing: true });

    expect(h.runsOf(SLOW_FILE)).toHaveLength(2);
    expect(h.sink.stateOf(fileLevel)).toMatchObject({ outcome: "fail", validity: "current" });
    expect(readFlakyNotes(store).get(checkIdentity(fileLevel))).toBeUndefined();
    const why = formatWhy(readWhy(h.root, SLOW_FILE, {}));
    expect(why).toContain("SECOND_ERROR_01119");
    expect(why).toMatch(
      /\n {2}First error, before its re-run \(run \S+, key [0-9a-f]{12}\): error after its tests ran: FIRST_ERROR_01119\n {4}Its log: \S+/,
    );
    expect(why).not.toMatch(/flaky/i);
  });

  it("never re-runs a slow file's real test failure", async () => {
    const { h } = await started({ once: false, testFails: true });

    expect(h.runsOf(SLOW_FILE)).toHaveLength(1);
    expect(h.sink.stateOf(cleans)).toMatchObject({ outcome: "fail", validity: "current" });
  });
});
