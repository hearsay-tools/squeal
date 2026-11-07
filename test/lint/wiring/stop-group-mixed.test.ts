import { describe, expect, it } from "vitest";
import { readPolicy } from "../../../src/core/daemon/policy.js";
import { readStopHolds } from "../../../src/core/delivery/turn.js";
import { releaseLintGroup } from "../../../src/core/lint/pass/commit-entry.js";
import { refinedMetaKey } from "../../../src/core/types/scheduler.js";
import { ADDS, FILE, type SquealRepo } from "../../harness/helpers.js";
import {
  HARNESSES,
  type Harness,
  listenAsDaemon,
  mainConsumer,
  markStopWait,
} from "../../harness/stop-slow-helpers.js";
import { result } from "../../state/helpers.js";
import { hookedRepo } from "./rig.js";

/*
 * Review 0.1.406-r2 B2-R1 (spec 019 D4 steps 1 and 3; 017 D8): a lint
 * group and a test group at `stop`, under `lint.blocking`. The lint
 * finished before Stop with a failure; the test group is not settled: its
 * file is queued, keyed and not queued (a lookup-only miss), or the runner
 * part that may list its files is pending. Stop holds for the test group
 * first, and for the lint failure only once the tests are settled, all in
 * one `stop.maxHolds` budget. The 2 s entry never spends a hold on the lint
 * failure while a required test is not settled. Claude Code and Codex;
 * with the waiting entry known, and without it (the 2 s entry decides alone).
 */

const AT_STOP = { name: "lint", lint: true, at: "stop" };
const UNIT = { name: "unit", runner: "vitest", tests: [FILE.path], at: "stop" };
const FAIL_LINE = "FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)";
const BLOCKING =
  "Squeal policy lint.blocking is on and 1 file went to fail lint since this session started: src/a.js (1 finding).";
const UNIT_KEY = "unit-new";
/** A hold naming the unit group open, which the agent answers with `squeal run unit --wait`. */
const UNIT_OPEN =
  /checks puts the unit group at stop and (1 unit test file is not current|the runner part of revision \d+ is still pending)/;

/** How the unit group is not settled at Stop. */
type Open = "queued" | "lookup-only" | "runner part";

const latest = (r: SquealRepo) => r.store.revisions.latest(r.worktreeId)?.number ?? 0;

/** The unit test file moves to a new key with no result, queued or not. */
function unitKey(r: SquealRepo, pending: "queued" | null): void {
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: FILE, key: UNIT_KEY, revision: latest(r), pending },
  ]);
  r.sink.refresh(r.worktreeId, latest(r), { checkpointId: null });
}

/** The unit test's run passes at its new key, as the daemon stores it. */
function landUnit(r: SquealRepo): void {
  const ran = result(ADDS, "pass", {
    key: UNIT_KEY,
    worktreeId: r.worktreeId,
    revision: latest(r),
  });
  r.store.transaction(() => r.store.results.putMany([ran]));
  r.store.testFileKeys.upsertMany([
    { worktreeId: r.worktreeId, testFile: FILE, key: UNIT_KEY, revision: latest(r), pending: null },
  ]);
  r.sink.applyResults(r.worktreeId, latest(r), [ran], { checkpointId: null });
}

/** The runner part of the latest revision applied: it listed no new file. */
const refine = (r: SquealRepo) => r.store.meta.set(refinedMetaKey(r.worktreeId), String(latest(r)));

/**
 * A session in a turn whose edit to `src/a.js` the lint group at `stop`
 * linted to a failure before its Stop (`squeal run lint`), with the unit
 * group not settled as `open` says; `known`: the waiting entry ran for the
 * session before. A daemon whose `run-group` runs the unit test to a pass.
 */
async function mixed(harness: Harness, open: Open, maxHolds: number, known: boolean) {
  const policy = { checks: [AT_STOP, UNIT], stop: { slowWaitMs: 5_000, maxHolds } };
  const hooked = await hookedRepo(
    { "src/a.js": "ok\n" },
    { enabled: true, blocking: true },
    policy,
  );
  const { r, tree } = hooked;
  await harness.startTurn(r);
  if (known) markStopWait(r, harness.name);
  await hooked.edit({ "src/a.js": "bad no-undef\n" });
  if (open === "runner part") r.store.meta.set(refinedMetaKey(r.worktreeId), String(latest(r) - 1));
  else unitKey(r, open === "queued" ? "queued" : null);
  const blobOf = (path: string) => tree.source.file(path)?.hash ?? null;
  releaseLintGroup(r.repo.commonDir, readPolicy(r.root), r.worktreeId, "lint", blobOf);
  await hooked.settle();
  const asked: string[] = [];
  await listenAsDaemon(r.store, r.worktreeId, {
    requestGroup: async (group) => {
      asked.push(group);
      if (group === "unit") landUnit(r);
      return { revision: latest(r), queued: group === "unit" ? 1 : 0 };
    },
  });
  return { r, asked };
}

/** One continuation: what the entry that spoke printed, and the groups asked by then. */
interface Said {
  readonly out: string;
  readonly asked: readonly string[];
}

/**
 * Stops one after another, each after Squeal's continuation, until both
 * entries are silent. The waiting entry runs only after a silent 2 s entry
 * (`known`); while it runs, the runner part applies after 300 ms. After a
 * hold naming the unit group open, the agent runs `squeal run unit --wait`:
 * the unit test passes, or the runner part applies.
 */
async function stopsUntilSilent(
  harness: Harness,
  r: SquealRepo,
  { open, known, asked }: { open: Open; known: boolean; asked: readonly string[] },
): Promise<Said[]> {
  const said: Said[] = [];
  const settle = () => (open === "runner part" ? refine(r) : landUnit(r));
  for (let stop = 0; stop < 6; stop++) {
    const overrides = stop === 0 ? {} : { stop_hook_active: true };
    let out = (await harness.stop(r, overrides)).stdout.trim();
    if (out === "" && known) {
      const timer = open === "runner part" ? setTimeout(() => refine(r), 300) : undefined;
      try {
        out = (await harness.stopSlow(r, overrides)).stdout.trim();
      } finally {
        clearTimeout(timer);
      }
    }
    if (out === "") return said;
    said.push({ out, asked: [...asked] });
    if (UNIT_OPEN.test(out)) settle();
  }
  throw new Error(`Stop never fell silent: ${said.length} continuations`);
}

describe.each(HARNESSES)(
  "a lint failure beside an unsettled test group, $name (review 0.1.406-r2 B2-R1)",
  (harness) => {
    const cases = (["queued", "lookup-only", "runner part"] as const).flatMap((open) =>
      [1, 2].flatMap((maxHolds) => [true, false].map((known) => ({ open, maxHolds, known }))),
    );
    it.each(cases)(
      "$open, stop.maxHolds $maxHolds, waiting entry known $known: tests first, then the lint failure",
      async ({ open, maxHolds, known }) => {
        const { r, asked } = await mixed(harness, open, maxHolds, known);
        const said = await stopsUntilSilent(harness, r, { open, known, asked });
        const first = said[0]?.out ?? "";
        expect(first, "no hold spent on lint while the unit group is not settled").not.toContain(
          BLOCKING,
        );
        expect(said.map((s) => s.out).join("\n"), "the finding told").toContain(FAIL_LINE);
        const blocking = said.filter((s) => s.out.includes(BLOCKING));
        expect(readStopHolds(r.store, mainConsumer(r)), "the turn's holds spent").toBe(maxHolds);
        if (known) {
          // The 2 s entry tells the finding as news; the waiting entry asks for the tests, then holds.
          if (open !== "runner part") expect(asked).toEqual(["unit"]);
          expect(blocking, "each hold for the lint failure").toHaveLength(maxHolds);
          if (open !== "runner part") {
            expect(
              blocking.every((s) => s.asked.includes("unit")),
              "after the tests ran",
            ).toBe(true);
          }
        } else {
          // The 2 s entry holds first naming the unit group, then for the lint failure.
          expect(first).toMatch(
            open === "runner part"
              ? /runner part of revision \d+ is still pending/
              : /unit test file is not current/,
          );
          expect(blocking, "the holds left after the tests").toHaveLength(maxHolds - 1);
        }
      },
    );
  },
);
