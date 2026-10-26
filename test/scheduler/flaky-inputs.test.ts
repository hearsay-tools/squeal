import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { checkIdentity, FLAKY_INPUTS_TEXT, readFlakyNotes } from "../../src/core/state/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import type { CheckId, Policy } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { idleAfterQuiet } from "./quiet-clock.js";

/*
 * Row 011-244 (gh-98): a FAIL -> PASS at one key reads "under the same
 * tracked inputs", and the notice and `squeal why` point once to `inputs` in
 * squeal.config.json. The test file reads a data file with `fs`, which this
 * harness's runner does not observe, and a marker outside the worktree, which
 * nothing tracks. Its first run fails, its re-run (001-171) is held while one
 * of them changes, then passes: an undeclared data file keeps the key, a
 * declared one moves it, and the marker is a real same-key flip.
 */

const FILE = "test/durations.test.ts";
const DATA = "data/durations.json";
const reads: CheckId = {
  kind: "test",
  project: "",
  testPath: FILE,
  fullName: "reads the durations",
};
const NAME = `${FILE} > reads the durations`;

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

/** A repository whose test fails while `ok` is false in the data file or the marker exists. */
function durationsRepo(ok: boolean, marked: boolean) {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-011-244-${randomUUID()}`);
  markers.push(marker);
  writeFileSync(
    join(repo.main, FILE),
    [
      'import { existsSync, readFileSync } from "node:fs";',
      'import { expect, it } from "vitest";',
      "",
      'it("reads the durations", () => {',
      `  const { ok } = JSON.parse(readFileSync(new URL("../${DATA}", import.meta.url), "utf8"));`,
      `  expect(ok && !existsSync(${JSON.stringify(marker)})).toBe(true);`,
      "});",
      "",
    ].join("\n"),
  );
  mkdirSync(join(repo.main, "data"));
  writeFileSync(join(repo.main, DATA), `${JSON.stringify({ ok })}\n`);
  git(repo.main, ["add", FILE, DATA]);
  git(repo.main, ["commit", "-qm", "durations"]);
  if (marked) writeFileSync(marker, "");
  return { ...repo, marker };
}

/**
 * Starts a worktree whose first run of the test fails and is told, holds its
 * re-run while `change` runs, then lets it run; returns the notice the
 * consumer gets after it and `why` for the check. A file re-keyed through a
 * declared input alone is catch-up, which waits for quiet (row 011-153).
 */
async function flipAround(
  repo: ReturnType<typeof durationsRepo>,
  change: (h: Awaited<ReturnType<typeof openHarness>>) => Promise<void>,
  policy: Partial<Policy> = {},
) {
  const store = openRepoStore(repo.commonDir);
  const h = await openHarness(repo.main, store, repo.commonDir, {
    policy: { ...RUN_MISSING, ...policy },
  });
  const gates: (() => void)[] = [];
  const reached: (() => void)[] = [];
  const atRun = [0, 1].map((i) => new Promise<void>((resolve) => (reached[i] = resolve)));
  const held = [0, 1].map((i) => new Promise<void>((resolve) => (gates[i] = resolve)));
  let seen = 0;
  h.runner.beforeRun = async (files) => {
    if (!files.some((f) => f.path === FILE)) return;
    const i = seen++;
    reached[i]?.();
    await held[i];
  };
  await h.scheduler.start();
  await atRun[0];
  const { delivery, consumer } = await h.consumer();
  const failedKey = h.keyOf(FILE);
  gates[0]?.();
  await atRun[1];
  const failed = await delivery.onToolBoundary(consumer);
  expect(failed?.entries.map((e) => [e.check, e.kind])).toEqual([[reads, "first-seen-fail"]]);

  await change(h);
  gates[1]?.();
  await idleAfterQuiet(h);
  expect(h.sink.stateOf(reads)).toMatchObject({ outcome: "pass", validity: "current" });
  const healed = await delivery.onToolBoundary(consumer);
  expect(healed?.entries.map((e) => [e.check, e.kind])).toEqual([[reads, "fail-to-pass"]]);
  return {
    moved: h.keyOf(FILE) !== failedKey,
    note: readFlakyNotes(store).get(checkIdentity(reads)),
    notice: formatDelta(healed ?? expect.fail("no delta")),
    why: formatWhy(readWhy(h.root, NAME)),
  };
}

const NOTICE_LINES = `\n      Flaky: FAIL -> PASS under the same tracked inputs\n      ${FLAKY_INPUTS_TEXT}`;
const WHY_LINE =
  /\n {2}Flaky: FAIL -> PASS under the same tracked inputs \(key [0-9a-f]{12}, [^)]+\)\n/;

/** The notice and `why` of a same-key flip: the qualified line, then the pointer once. */
function expectQualified({ notice, why }: { notice: string; why: string }) {
  expect(notice).toContain(NOTICE_LINES);
  expect(notice.split(FLAKY_INPUTS_TEXT)).toHaveLength(2);
  expect(why).toMatch(WHY_LINE);
  expect(why).toContain(`\n    ${FLAKY_INPUTS_TEXT}\n`);
  expect(why.split(FLAKY_INPUTS_TEXT)).toHaveLength(2);
  expect(`${notice}\n${why}`).not.toContain("under the same inputs");
}

const writeData = async (h: Awaited<ReturnType<typeof openHarness>>) => {
  h.write(DATA, `${JSON.stringify({ ok: true })}\n`);
  await h.batch(DATA);
};

describe("a flaky note names only the inputs Squeal tracks (row 011-244, gh-98)", SLOW, () => {
  it("an undeclared data file changed under one key: same tracked inputs, and the pointer", async () => {
    const flip = await flipAround(durationsRepo(false, false), writeData);
    expect(flip.moved).toBe(false);
    expect(flip.note).toMatchObject({ from: "fail", to: "pass" });
    expectQualified(flip);
  });

  it("the same data file declared in `inputs`: its change moves the key, so no note", async () => {
    const flip = await flipAround(durationsRepo(false, false), writeData, {
      inputs: { [FILE]: [DATA] },
    });
    expect(flip.moved).toBe(true);
    expect(flip.note).toBeUndefined();
    expect(flip.notice).toContain("\n      FAIL -> PASS");
    for (const text of [flip.notice, flip.why]) {
      expect(text).not.toContain("Flaky:");
      expect(text).not.toContain(FLAKY_INPUTS_TEXT);
    }
  });

  it("a real same-key flip reads as the undeclared change does", async () => {
    const repo = durationsRepo(true, true);
    const flip = await flipAround(repo, async () => rmSync(repo.marker));
    expect(flip.moved).toBe(false);
    expect(flip.note).toMatchObject({ from: "fail", to: "pass" });
    expectQualified(flip);
  });
});
