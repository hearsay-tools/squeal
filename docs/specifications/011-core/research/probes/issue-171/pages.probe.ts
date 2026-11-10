// Throwaway probe for issue 171. See README.md.
import { expect, it } from "vitest";
import { createDelivery } from "../../../../../../src/core/delivery/delivery.js";
import { formatDelta } from "../../../../../../src/core/delivery/format.js";
import { createStateSink } from "../../../../../../src/core/state/sink.js";
import type { Consumer } from "../../../../../../src/core/types/delivery.js";
import type { TestFileRef } from "../../../../../../src/core/types/keys.js";
import { check, freshStore, result, setKey, WT } from "../../../../../../test/state/helpers.js";
import { fixedStatus } from "../../../../../../test/delivery/fakes.js";

const NONE = { checkpointId: null };
const C: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const FILES: TestFileRef[] = Array.from({ length: 12 }, (_, i) => ({ project: "server", path: `packages/cezar/src/f${i}.test.ts` }));
// 60 checks over 12 files, each with its own error text (as in the issue: distinct messages)
const CHECKS = FILES.flatMap((f, i) => Array.from({ length: 5 }, (_, j) => check(`suite > case ${i}.${j}`, f)));

function setup() {
  const store = freshStore();
  let clock = 10_000;
  const sink = createStateSink(store, { now: () => clock });
  const delivery = createDelivery(store, { status: fixedStatus(), now: () => clock, pollIntervalMs: 5 });
  for (const f of FILES) setKey(store, "k1", { file: f });
  return { store, sink, delivery, tick: () => (clock += 1000) };
}

const failMsg = (i: number) => `Not a HomeStore file: /tmp/cez-vitest-tmp-${i}/config.json expected ${i}`;

function log(label: string, text: string | null) {
  // eslint-disable-next-line no-console
  console.log(`\n===== ${label} =====\n${text ?? "(null: nothing delivered)"}`);
}

it("A: all 60 PASS->FAIL in one result batch: one delivery, the cut tail is told, no repeat", async () => {
  const { sink, delivery, tick } = setup();
  sink.applyResults(WT, 0, CHECKS.map((c) => result(c, "pass", { revision: 0 })), NONE);
  await delivery.register(C);
  tick();
  sink.applyResults(WT, 1, CHECKS.map((c, i) => result(c, "fail", { revision: 1, message: failMsg(i) })), NONE);
  const d1 = await delivery.onToolBoundary(C);
  expect(d1?.entries.length).toBe(60);
  const text = formatDelta(d1!);
  log("A boundary 1", text.split("\n").filter((l) => /^(SQUEAL|FAIL|Not shown)/.test(l)).join("\n"));
  const shown = text.split("\n").filter((l) => l.startsWith("FAIL")).length;
  console.log(`A: entries=${d1!.entries.length} FAIL lines shown=${shown} chars=${text.length}`);
  for (let k = 2; k <= 7; k++) {
    tick();
    const d = await delivery.onToolBoundary(C);
    log(`A boundary ${k} (no change)`, d === null ? null : formatDelta(d));
    expect(d).toBeNull();
  }
});

it("B: same 60 failures arrive over 6 result batches at revision 1: each boundary tells only new checks", async () => {
  const { sink, delivery, tick } = setup();
  sink.applyResults(WT, 0, CHECKS.map((c) => result(c, "pass", { revision: 0 })), NONE);
  await delivery.register(C);
  const seen = new Set<string>();
  for (let b = 0; b < 6; b++) {
    tick();
    const batch = CHECKS.slice(b * 10, b * 10 + 10);
    sink.applyResults(WT, 1, batch.map((c, i) => result(c, "fail", { revision: 1, message: failMsg(b * 10 + i) })), NONE);
    const d = await delivery.onToolBoundary(C);
    const names = d!.entries.map((e) => ("check" in e ? (e.check as { fullName: string }).fullName : "?"));
    const repeats = names.filter((n) => seen.has(n));
    names.forEach((n) => seen.add(n));
    const text = formatDelta(d!);
    console.log(`B boundary ${b + 1}: entries=${names.length} repeats=${repeats.length} title=${text.split("\n")[0]}`);
    expect(repeats).toEqual([]);
  }
  tick();
  const quiet = await delivery.onToolBoundary(C);
  console.log(`B after drain: ${quiet === null ? "null (quiet)" : "delivered"}`);
  expect(quiet).toBeNull();
});

it("C: a re-run of the same failures with a new run id and same text at revision 1 stays quiet", async () => {
  const { sink, delivery, tick } = setup();
  sink.applyResults(WT, 0, CHECKS.map((c) => result(c, "pass", { revision: 0 })), NONE);
  await delivery.register(C);
  sink.applyResults(WT, 1, CHECKS.map((c, i) => result(c, "fail", { revision: 1, message: failMsg(i) })), NONE);
  expect((await delivery.onToolBoundary(C))?.entries.length).toBe(60);
  tick();
  // same failures again (a rerun) with the tmp dir name changed, as the issue's text has
  sink.applyResults(WT, 1, CHECKS.map((c, i) => result(c, "fail", { revision: 1, message: failMsg(i).replace(`tmp-${i}`, `tmp-x${i}`) })), NONE);
  const d = await delivery.onToolBoundary(C);
  console.log(`C rerun same failure, other tmp name: ${d === null ? "null (quiet)" : `${d.entries.length} entries: ${[...new Set(d.entries.map((e) => e.kind))].join(",")}`}`);
  tick();
  // and with a changed first error line
  sink.applyResults(WT, 1, CHECKS.map((c, i) => result(c, "fail", { revision: 1, message: `other text ${i}` })), NONE);
  const e = await delivery.onToolBoundary(C);
  console.log(`C rerun changed text: ${e === null ? "null" : `${e.entries.length} entries: ${[...new Set(e.entries.map((x) => x.kind))].join(",")}`}`);
});
