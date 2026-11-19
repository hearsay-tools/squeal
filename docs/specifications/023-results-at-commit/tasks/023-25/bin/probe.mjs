// Row 023-25 probe: one test file's key inputs in the worktree and in a checkout at a commit.
// usage: node probe.mjs <squeal-dir> <worktree> <commit> <project> <path> <out.json>
import { writeFileSync } from "node:fs";

const [sq, root, commitArg, project, path, out] = process.argv.slice(2);
const d = (m) => import(`${sq}/dist/${m}`);
const { withKeyer, withCheckout } = await d("core/commit/at-keys-walk.js");
const { withStores, commonDirOf, resolveCommit } = await d("core/commit/at-keys-checkout.js");
const { daemonAdapters } = await d("cli/code-gate-stored.js");
const { squealVersion } = await d("core/daemon/version.js");
const { testFileId } = await d("core/keys/reverse-index.js");

const commonDir = commonDirOf(root);
const commit = await resolveCommit(root, commitArg);
const id = testFileId({ project, path });
const keying = { adapters: daemonAdapters, squealVersion: squealVersion(), env: process.env };

async function dump(tree, main) {
  return withKeyer(tree, commonDir, main ?? undefined, keying, async (open) => {
    const ref = open.listed.get(id);
    if (ref === undefined) return { unlisted: true };
    const keyed = await open.keyer.keyed([ref]);
    const at = keyed.get(ref);
    const keys = open.keyer.keys;
    const entry = keys.index.keyed.get(id);
    return {
      tree,
      key: at?.key ?? null,
      environment: keys.index.environment(project) ?? null,
      dependencies: entry?.dependencies ?? null,
      runtime: entry?.runtime ?? null,
      observed: keys.observedOf(ref),
      paths: entry ? entry.closure.paths.map((p, i) => [p, entry.entries[i].hash ?? null]) : null,
      loads: at?.loads ?? null,
      environments: keys.environmentFiles(project),
    };
  });
}

const result = await withStores(commonDir, async (main) => {
  const worktree = await dump(root, main);
  const checkout = await withCheckout({ root, commonDir, commit }, {}, (c) => dump(c.tree, main));
  return { commit, worktree, checkout };
});
writeFileSync(out, JSON.stringify(result, null, 1));
const { worktree: w, checkout: c } = result;
console.log("key", w.key, c.key);
for (const f of ["environment", "dependencies", "runtime"]) console.log(f, w[f] === c[f] ? "same" : `DIFF\n  ${w[f]}\n  ${c[f]}`);
const wm = new Map(w.paths), cm = new Map(c.paths);
for (const [p, h] of wm) if (!cm.has(p)) console.log("only worktree", p, h);
  else if (cm.get(p) !== h) console.log("hash differs", p, h, cm.get(p));
for (const [p, h] of cm) if (!wm.has(p)) console.log("only checkout", p, h);
console.log("paths", wm.size, cm.size, "observed", w.observed.length, c.observed.length);
