import { readFileSync } from "node:fs";
const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cks = new Map();
for (const o of rows) { const c = cks.get(o.ck) ?? cks.set(o.ck, { o, n: 0, ran: 0, s: 0, keyed: 0, same: 0, sameCommit: 0, sameCommitLiveOther: 0, before: 0 }).get(o.ck);
  c.n++; if (o.ran) c.ran++; c.s += o.secs ?? 0; if (o.key) c.keyed++; if (o.sameKeyBefore?.length) c.same++; if (o.sameCommitBefore.length) c.sameCommit++; if (o.newestBefore) c.before++; }
for (const c of [...cks.values()].sort((a, b) => a.o.ckStart - b.o.ckStart)) console.log(new Date(c.o.ckStart).toISOString().slice(5, 16), c.o.w.slice(0, 8), c.o.live ? "L" : "R", "rev" + c.o.ckRev, c.o.ckEnd, (c.o.commit ?? "-").slice(0, 9), "d" + c.o.dirty, `miss ${c.n} ran ${c.ran} ${Math.round(c.s)}s keyed ${c.keyed} sameKeyBefore ${c.same} sameCommitBefore ${c.sameCommit} anyBefore ${c.before}`);
