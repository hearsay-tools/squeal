const { installedDependencies } = await import(`${process.env.SQUEAL_SRC}/core/keys/environment.ts`);
const { staleHiddenLockfile } = await import(`${process.env.SQUEAL_SRC}/core/keys/hidden-lockfile.ts`);
import { readFileSync } from "node:fs";
for (const root of process.argv.slice(2)) {
  const d = await installedDependencies(root as never, root as never);
  const stale = staleHiddenLockfile(root, readFileSync(root + "/node_modules/.package-lock.json", "utf8"));
  console.log(root, "fingerprint", d.fingerprint.slice(0, 12), "graph", d.graph !== null, "stale:", stale, "note:", d.note);
}
