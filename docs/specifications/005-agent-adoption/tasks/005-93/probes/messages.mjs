// Throwaway probe for the 005-93 design note. Read-only on Claude Code transcripts.
// Usage: node messages.mjs <days> > out.json
// Counts PostToolBatch SQUEAL messages (hook_additional_context, once each) in this repository's and
// cezar's transcripts modified in the last <days> days, by the edit lines and notices 005-93 touches.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const root = join(process.env.HOME, ".claude", "projects");
const since = Date.now() - Number(process.argv[2] ?? 4) * 86400e3;
const kinds = {
  settled: /re-keyed (?:is|are) current\.|re-keyed finished:/,
  sawSettled: /Squeal saw your edit; (?:the 1 test file|all \d+ test files|of the \d+ test file)/,
  sawEdit: /Squeal saw your edit and queued|Squeal saw your edit, which re-keyed/,
  heartbeatLate: /heartbeat is late|SQUEAL · the daemon's heartbeat/,
  validatingAgain: /validating again|heartbeat is current again/,
  feedLate: /has not yet read edits made after|Squeal is behind:/,
  pending: /: [^.\n]*\d+ pending/,
  changed: /^SQUEAL · \d+ checks? changed/m,
  revisionOnly: /^SQUEAL · revision \d+\n/,
};
const out = {};
for (const project of ["squeal", "cezar"]) {
  const counts = { transcripts: 0, withPostToolBatch: 0, messages: 0, sessionsWithSawEdit: 0 };
  for (const k of Object.keys(kinds)) counts[k] = 0;
  const pendingCounts = [];
  for (const dir of readdirSync(root).filter((d) => d.startsWith(`-home-user-projects-${project}`))) {
    for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith(".jsonl"))) {
      const path = join(root, dir, f);
      if (statSync(path).mtimeMs < since) continue;
      counts.transcripts++;
      let any = false, saw = false;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.includes('"hook_additional_context"') || !line.includes("PostToolBatch")) continue;
        let l; try { l = JSON.parse(line); } catch { continue; }
        const a = l.attachment;
        if (a?.type !== "hook_additional_context" || a.hookEvent !== "PostToolBatch") continue;
        const text = (a.content ?? []).join("\n");
        if (!text.includes("SQUEAL")) continue;
        any = true; counts.messages++;
        for (const [k, re] of Object.entries(kinds)) if (re.test(text)) counts[k]++;
        if (kinds.sawEdit.test(text) || kinds.sawSettled.test(text)) saw = true;
        const m = /^Revision [^:\n]*: ([^\n]*)/m.exec(text);
        const p = m && /(\d+) pending/.exec(m[1]);
        if (p) pendingCounts.push(Number(p[1]));
      }
      if (any) counts.withPostToolBatch++;
      if (saw) counts.sessionsWithSawEdit++;
    }
  }
  pendingCounts.sort((a, b) => a - b);
  const q = (p) => pendingCounts[Math.max(0, Math.ceil(p * pendingCounts.length) - 1)];
  counts.newsPendingCount = { n: pendingCounts.length, p50: q(.5), p90: q(.9), max: pendingCounts.at(-1) };
  out[project] = counts;
}
console.log(JSON.stringify(out, null, 1));
