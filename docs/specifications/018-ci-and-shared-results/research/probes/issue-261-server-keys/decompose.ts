// Throwaway (row 018-72). For the sampled pull-run files of one event (out-week-samples.json),
// which environment and closure list reproduce the run's key at the commit, against the import's.
// Candidates: every local (ci=false) environment of the project recorded in the window; the
// export's closure list, the store's list + observed now, and that + observedModules.
// Reads squawk's store read-only and `git ls-tree`. Usage: tsx decompose.ts <export.json> "<event>"
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { keyOver, commitSegments, NO_PARTS } from "../../../../../../src/core/store/transfer-rekey.ts";
import { isClosurePath } from "../../../../../../src/core/keys/closure.ts";

const [file, event] = process.argv.slice(2);
const e = JSON.parse(readFileSync(file, "utf8"));
const samples = JSON.parse(readFileSync(process.env.SAMPLES ?? new URL("./out-week-samples.json", import.meta.url), "utf8")).samples[event];
const repo = `${process.env.HOME}/projects/cezar`;
const db = new DatabaseSync(`${repo}/.git/squeal/store.sqlite`, { readOnly: true });
db.exec("PRAGMA query_only = 1");
const blobs = new Map<string, string>();
for (const line of execFileSync("git", ["-C", repo, "ls-tree", "-r", e.header.commit], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")) {
  const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
  if (m) blobs.set(m[2], m[1]);
}
const at = commitSegments(blobs as never);
const byPath = new Map(e.testFiles.map((f: { project: string; path: string }) => [`${f.project}\0${f.path}`, f]));
const ciHash = new Map(e.environments.map((x: { project: string; hash: string }) => [x.project, x.hash]));
const envs = db.prepare("select hash from environments where json_extract(descriptor,'$.project') = ? and recorded_at > ?").all("server", Number(process.env.ENVS_SINCE ?? Date.parse("2026-11-13"))) as { hash: string }[];
const meta = (k: string) => JSON.parse((db.prepare("select value from meta where key = ?").get(k) as { value: string } | undefined)?.value ?? "{}");
const obs = meta("observed.server"), mods = meta("observedModules.server");
const tally: Record<string, number> = {};
const t = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
for (const s of samples as { path: string; project: string; keys: string[]; importKeys: [string, string][] }[]) {
  const f = byPath.get(`${s.project}\0${s.path}`) as { key: string; closure: { paths: string[] }; keyParts?: { dependencies: string; runtime: string } } | undefined;
  if (!f) { t("not in this export"); continue; }
  const stored: string[] = JSON.parse((db.prepare("select closure_paths c from test_files where project=? and path=?").get(s.project, s.path) as { c: string }).c);
  const local = [...new Set([...stored, ...(obs[s.path] ?? []).filter(isClosurePath)])].sort();
  const lists: Record<string, string[]> = { exportList: f.closure.paths, storeListNow: local, storeListNowPlusModules: [...new Set([...local, ...(mods[s.path] ?? [])])].sort() };
  const ref = { project: s.project, path: s.path };
  let found = "no candidate reproduces the run key";
  outer: for (const [ln, list] of Object.entries(lists)) for (const parts of [f.keyParts ?? NO_PARTS, NO_PARTS]) for (const env of [ciHash.get(s.project) as string, ...envs.map((x) => x.hash)]) {
    if (s.keys.includes(keyOver(env as never, ref as never, list, at, parts))) {
      const importEnvs = [...new Set(s.importKeys.map(([, ie]) => ie.slice(0, 10)))].join(",");
      found = `run env ${env.slice(0, 10)}${env === ciHash.get(s.project) ? " (CI)" : ""} via ${ln}; import envs ${importEnvs}; same env as an import row: ${s.importKeys.some(([, ie]) => ie === env)}`;
      break outer;
    }
  }
  t(found);
}
console.log(JSON.stringify({ event, export: e.header.commit.slice(0, 8), squeal: e.header.squealVersion, samples: samples.length, tally }, null, 1));
