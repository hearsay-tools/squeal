import { open, loadedPaths, inflateJson } from "./lib.mjs";
const [store, code] = process.argv.slice(2);
const s = open(store), c = open(code);
const rows = c.prepare("select result_key, record, recorded_at from coverage order by recorded_at desc limit 3").all();
for (const r of rows) {
  const lp = loadedPaths(r.record);
  const res = s.prepare("select r.outcome, ch.kind, ch.project, ch.test_path, r.worktree_id, r.revision from results r join checks ch on ch.id=r.check_id where r.key=? limit 3").all(r.result_key);
  const imp = s.prepare("select project, path, environment, imports from test_file_imports where key=?").get(r.result_key);
  console.log(r.result_key.slice(0, 16), lp.paths.length, lp.unread.length, lp.paths.slice(0, 5), res, imp && { path: imp.path, env: imp.environment.slice(0, 12), n: inflateJson(imp.imports).length, first: inflateJson(imp.imports)[0] });
}
const ew = s.prepare("select project, environment, files, roots, length(imports) l from environment_walks limit 2").all();
for (const e of ew) console.log(e.project, e.environment.slice(0,12), e.files.slice(0, 300), e.roots.slice(0, 200), e.l);
