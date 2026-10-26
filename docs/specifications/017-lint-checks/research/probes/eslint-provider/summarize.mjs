// Throwaway probe (017-01). Groups warm.mjs mismatches by the change in force:
// the open mutation window, or the plain edit kind outside windows.
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n").filter((l) => l.startsWith('{"step"'));
const groups = {};
for (const l of lines) {
  const r = JSON.parse(l);
  const k = Math.floor(r.step / 16), phase = r.step % 16;
  const inWindow = k < 12 && phase >= 5 && phase <= 11;
  const cause = inWindow ? `window ${k}` : r.what.startsWith("reset") ? "reset" : r.what.replace(/ v\d$/, "") + " (plain)";
  const files = [...new Set([...Object.keys(r.keptDiff ?? {}), ...Object.keys(r.freshDiff ?? {})])];
  const g = (groups[cause] ??= { kept: 0, fresh: 0, files: new Set(), whats: new Set() });
  if (!r.keptOk) g.kept++; if (!r.freshOk) g.fresh++;
  files.forEach((f) => g.files.add(f)); g.whats.add(r.what.replace(/ v\d$/, "").replace(/ comment$/, ""));
}
for (const [c, g] of Object.entries(groups)) console.log(c.padEnd(22), `kept ${g.kept}`.padEnd(9), `new-instance ${g.fresh}`.padEnd(16), [...g.files].join(" "), "|", [...g.whats].join("; "));
