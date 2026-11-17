// Throwaway probe (011-385). Summarises join.cjs output: listing and delivery delays, timeouts.
const fs = require("fs");
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
const fmt = (a) => `n=${a.length} median ${q(a, 0.5)} p75 ${q(a, 0.75)} p90 ${q(a, 0.9)} max ${q(a, 1)}`;
for (const f of process.argv.slice(2)) {
  const r = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const j = r.filter((x) => x.listS !== null && x.listS >= -60);
  console.log(`== ${f}: ${r.length} transcripts with an unlisted text; ${j.length} joined to a daemon start`);
  console.log(" stretch to first listed text, s (all closed):", fmt(r.filter((x) => x.stretchS !== null).map((x) => x.stretchS)));
  console.log(" never closed in transcript:", r.filter((x) => x.stretchS === null).length);
  console.log(" unlisted text -> daemon listing commit, s:", fmt(j.map((x) => x.listS)));
  console.log(" unlisted text -> serving, s:", fmt(j.filter((x) => x.servingS !== null).map((x) => x.servingS)));
  const d = j.filter((x) => x.deliverS !== null);
  console.log(" listing commit -> first listed text, s:", fmt(d.map((x) => x.deliverS)));
  console.log("   of them deliverS > 60 s:", d.filter((x) => x.deliverS > 60).length, " > 300 s:", d.filter((x) => x.deliverS > 300).length);
  const share = d.filter((x) => x.stretchS > 0).map((x) => x.deliverS / x.stretchS);
  console.log(" share of the stretch after the listing, median:", q(share.map((v) => v * 100), 0.5), "%");
  console.log(" timeouts in stretch:", fmt(r.map((x) => x.timeouts)), " stretches with >=1 timeout:", r.filter((x) => x.timeouts > 0).length);
  console.log(" closed by:", JSON.stringify(r.reduce((a, x) => ((a[x.listedEvent ?? "none"] = (a[x.listedEvent ?? "none"] ?? 0) + 1), a), {})));
  console.log(" via:", JSON.stringify(j.reduce((a, x) => ((a[x.via] = (a[x.via] ?? 0) + 1), a), {})), " rows:", fmt(j.filter((x) => x.rows).map((x) => x.rows)));
  console.log(" busy waits before serving, s:", fmt(j.map((x) => x.busyBeforeS)));
  console.log(" hand runs in stretch:", r.reduce((a, x) => a + x.hand, 0), " in", r.filter((x) => x.hand > 0).length, "stretches");
}
