// Throwaway probe (011-385). Joins stretches.cjs output with daemon-starts.cjs output by worktree
// root and time, and prints one line per stretch: seconds from the first unlisted text to the
// daemon's listing commit (listS), from the listing commit to the first listed text (deliverS),
// the hooks timed out in between, and the hand runs. Usage: node join.cjs <stretches> <starts>
const fs = require("fs");
const read = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const [sf, df] = process.argv.slice(2);
const starts = read(df).filter((d) => d.root);
const s = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);
for (const x of read(sf)) {
  const end = x.tListedText ?? x.tEnd;
  const cand = starts.filter((d) => d.root === x.cwd && d.first >= new Date(Date.parse(x.tUnlisted) - 600e3).toISOString() && d.first <= end)
    .sort((a, b) => a.first.localeCompare(b.first));
  const d = cand.find((c) => c.listed && c.listed.ts >= x.tUnlisted) ?? cand.find((c) => c.serving && c.serving >= x.tUnlisted) ?? cand[0] ?? null;
  const listedAt = d?.listed?.ts ?? d?.serving ?? null;
  console.log(JSON.stringify({
    id: x.cwd?.split("/").pop().slice(0, 8), tUnlisted: x.tUnlisted, firstEvent: x.firstEvent,
    stretchS: s(x.tUnlisted, x.tListedText), openToEndS: x.tListedText ? null : s(x.tUnlisted, x.tEnd),
    pid: d?.pid ?? null, firstLineS: s(x.tUnlisted, d?.first), listS: s(x.tUnlisted, listedAt), via: d?.listed?.via ?? (d?.serving ? "serving" : null),
    rows: d?.listed?.rows ?? null, servingS: s(x.tUnlisted, d?.serving), deliverS: s(listedAt, x.tListedText),
    busyBeforeListS: d && listedAt ? d.busyBefore.filter((b) => b.ts <= listedAt).reduce((a, b) => a + b.s, 0) : null,
    busyBeforeListWhat: d && listedAt ? d.busyBefore.filter((b) => b.ts <= listedAt && b.s >= 1).map((b) => b.what + " " + b.s) : null,
    listHoldMs: d?.listed?.ms ?? null,
    writesBeforeListMs: d && listedAt ? d.writesBefore.filter((w) => w.ts < listedAt && w.db === "store.sqlite" && !/commitFirst/.test(w.by)).reduce((a, w) => a + w.ms, 0) : null,
    busyBeforeS: d ? d.busyBefore.reduce((a, b) => a + b.s, 0) : null,
    timeouts: x.timeouts,
    // PostToolBatch hooks after the listing commit and before the first listed text, and how many timed out.
    postListing: listedAt ? x.boundaryTimes.filter(([t]) => t > listedAt).length : null,
    postListingTimeouts: listedAt ? x.boundaryTimes.filter(([t, o]) => t > listedAt && o).length : null,
    postListingBatches: listedAt ? x.batchTimes.filter((t) => t > listedAt).length : null,
    afterBoundary: x.afterBoundary, afterTimeouts: x.afterTimeouts, handCmds: x.handCmds, successText: x.successText, successSilent: x.successSilent, listedEvent: x.listedEvent, hand: x.hand, handAfter: x.handAfter, batches: x.batches, batchesAfter: x.batchesAfter,
  }));
}
