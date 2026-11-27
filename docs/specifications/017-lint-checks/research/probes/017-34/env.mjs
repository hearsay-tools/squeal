import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const lint = new DatabaseSync(process.argv[2], { readOnly: true });
const a = JSON.parse(readFileSync(process.argv[3]));
const cur = new Map(lint.prepare("select key, value from meta where key like 'lint-cursor:%'").all().map(r => [r.key.slice(12).replace(/:oxlint$/, ''), JSON.parse(r.value)]));
const REL = Date.parse("2026-11-19T21:07:41Z");
const firsts = a.filter(r => r.keying.mode === "first" && r.files > 1000).sort((x, y) => x.keying.at - y.keying.at);
const seen = new Map(); let sameEnvFull = 0, sameEnvHit = 0, newEnvFull = 0, newEnvHit = 0; const ex = [];
for (const r of firsts) {
  const env = cur.get(r.id)?.environment; const full = r.misses >= 0.5 * r.files;
  const prior = seen.get(env);
  if (prior !== undefined) { if (full) { sameEnvFull++; if (ex.length < 5) ex.push([r.id, prior.id, new Date(prior.keying.at).toISOString(), new Date(r.keying.at).toISOString(), r.misses, r.files]); } else sameEnvHit++; }
  else { if (full) newEnvFull++; else newEnvHit++; }
  if (!seen.has(env)) seen.set(env, r);
}
console.log({ firsts: firsts.length, envs: seen.size, sameEnvFull, sameEnvHit, newEnvFull, newEnvHit }); console.log(ex);
// refine: an earlier worktree at the same environment completed before this first keying
const byEnv = new Map();
for (const r of a) { const env = cur.get(r.id)?.environment; if (!env) continue; (byEnv.get(env) ?? byEnv.set(env, []).get(env)).push(r); }
let missAfterDone = 0, hitAfterDone = 0, ex2 = [];
for (const r of firsts) {
  const env = cur.get(r.id)?.environment; const full = r.misses >= 0.5 * r.files;
  const done = (byEnv.get(env) ?? []).filter(o => o.id !== r.id && o.pending === 0 && o.lastPart && o.lastPart < r.keying.at && o.files > 1000);
  if (!done.length) continue;
  if (full) { missAfterDone++; if (ex2.length < 3) ex2.push({ id: r.id, misses: r.misses, files: r.files, at: new Date(r.keying.at).toISOString(), doneBy: done[0].id, doneAt: new Date(done[0].lastPart).toISOString() }); } else hitAfterDone++;
}
console.log({ missAfterDone, hitAfterDone }, ex2);
