import { createVitestAdapter } from "./src/runners/vitest/index.js";
import { WorktreeKeys } from "./src/core/scheduler/keying.js";
import { loadPolicy } from "./src/core/daemon/policy.js";
import { createFsHasher } from "./src/core/hash/index.js";
import { readHead } from "./src/core/daemon-loop/head.js";
import { worktreeIdFor } from "./src/core/fs/index.js";
import { openStore, isStoreOpenFailure } from "./src/core/store/index.js";
import { statCandidates } from "./src/core/revision/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd();
execFileSync("git", ["init", "-q"], {cwd:root});
const store = openStore(join(root, ".git"));
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const adapter = await createVitestAdapter({root, maxWorkers:2});
try {
 const policy = loadPolicy(root).policy;
 const hasher = createFsHasher(root, "sha1");
 const head = () => readHead(root);
 const keys = new WorktreeKeys({root, worktreeId:worktreeIdFor(root), store, hasher, objectFormat:"sha1",policy,squealVersion:"0.1.298",onExtraFiles:()=>{}});
 await keys.bootstrap(head);
 keys.index.setEnvironment("", "review-environment");
 const refs = ["vitest", "node-test", "pytest", "driver"].map(r => ({project:"",path:`test/kit/${r}.test.ts`}));
 for (const ref of refs) {
  const closure = await adapter.closure(ref);
  keys.setClosure(closure);
 }
 await keys.trackUntracked();
 const getKeys = () => Object.fromEntries(refs.map(ref=>[ref.path, keys.index.key(ref)]));
 for (const edit of ["src/runners/node-test/recorders.ts", "src/runners/node-test/run/process.ts", "test/kit/packs/pytest.ts", "src/runners/node-test/runtime/reporter.mjs", "src/runners/pytest/runtime/squeal_pytest.py", "src/runners/observe/fs.cjs"]) {
  const path = join(root,edit), original=readFileSync(path,"utf8");
  const before=getKeys();
  try {
   writeFileSync(path,original+"\n"+(path.endsWith(".py")?"#":"//")+" review input change\n");
   const revision=await keys.reconcile({trigger:"watch",paths:await statCandidates([edit],hasher)},head);
   keys.index.rekey(revision?.changes.map(c=>c.path)??[]);
   const after=getKeys();
   console.log(JSON.stringify({edit,changed:refs.filter(r=>after[r.path]!==before[r.path]).map(r=>r.path)}));
  } finally {
   writeFileSync(path, original);
   const revision=await keys.reconcile({trigger:"watch",paths:await statCandidates([edit],hasher)},head);
   keys.index.rekey(revision?.changes.map(c=>c.path)??[]);
  }
 }
} finally { await adapter.close(); store.close(); }
