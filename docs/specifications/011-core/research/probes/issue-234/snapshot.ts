// Throwaway, deterministic interleaving at the public CLI output boundary.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const source = (path: string) => pathToFileURL(resolve(process.argv[2] ?? '.', path)).href;
const { waitForGroup } = await import(source('src/cli/run-group-wait.ts'));
const { worktreeIdFor } = await import(source('src/core/fs/git-layout.ts'));
const { openStore, isStoreOpenFailure } = await import(source('src/core/store/open.ts'));
import type { AbsolutePath, RelativePath, RevisionNumber } from '../../../../../../src/core/types/common.js';
import type { CheckKey } from '../../../../../../src/core/types/keys.js';
const load = loadavg()[0];
console.log(JSON.stringify({at:new Date().toISOString(),load,cpus:cpus().length,node:process.version}));
if (load > cpus().length) { console.log('SKIP: load exceeds CPU count'); process.exit(0); }
const root = mkdtempSync(join(tmpdir(),'sq-234-snapshot-')) as AbsolutePath;
const commonDir = join(root,'.git') as AbsolutePath;
mkdirSync(commonDir);
writeFileSync(join(commonDir,'HEAD'),'ref: refs/heads/main\n');
writeFileSync(join(root,'squeal.config.json'),JSON.stringify({complexity:{enabled:false},coverage:{enabled:false}}));
const store = openStore(commonDir);
if (isStoreOpenFailure(store)) throw new Error('cannot create isolated store');
const id = worktreeIdFor(root);
const testFile = {project:'',path:'test/a.test.ts' as RelativePath};
const revision = 0 as RevisionNumber;
store.worktrees.upsert({id,root,commonDir,isMain:true,registeredAt:1,daemon:null});
store.worktrees.setDaemon(id,{socketPath:join(root,'absent.sock'),startedAt:Date.now(),heartbeatAt:Date.now(),heartbeatIntervalMs:5000,squealVersion:'synthetic'});
const seed = (pending: boolean) => store.transaction(() => {
  store.testFileKeys.upsertMany([{worktreeId:id,testFile,key:'key-a' as CheckKey,revision,pending:pending?'queued':null}]);
  store.knownStates.upsertMany([{worktreeId:id,check:{kind:'file',project:'',testPath:testFile.path},outcome:'pass',validity:pending?'pending':'current',pendingPhase:pending?'queued':null,observedAt:revision,commit:null,origin:{kind:'own'},durationMs:1,location:null,summary:null,fingerprint:null}]);
});
try {
  seed(false);
  let first = true;
  const code = await waitForGroup({root,socketPath:join(root,'absent.sock') as AbsolutePath,group:'run-loop',queued:1,deadline:Date.now()+1000,line:'Request receipt (synthetic)',files:{kind:'list',files:[testFile]},narrow:{unmatched:[]}}, {
    stdout(text: string) {
      process.stdout.write(text.replaceAll(root,'<fixture>'));
      if (first) { first=false; seed(true); console.log('[probe queues the same file between verdict output and status read]'); }
    }, stderr:console.error, env:{}
  });
  console.log(`exit=${code}`);
  console.log('CONTROL: same selected file pending before verdict read');
  const pendingCode = await waitForGroup({root,socketPath:join(root,'absent.sock') as AbsolutePath,group:'run-loop',queued:1,deadline:Date.now()-1,line:'Request receipt (synthetic)',files:{kind:'list',files:[testFile]},narrow:{unmatched:[]}}, {
    stdout:(text: string)=>process.stdout.write(text.replaceAll(root,'<fixture>')), stderr:console.error, env:{}
  });
  console.log(`exit=${pendingCode}`);
} finally { store.close(); rmSync(root,{recursive:true,force:true}); }
