// Review 0.1.310 B1: the unknownStat sentinel survives a real store's write, close, reopen and StatCache.load.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const repo = process.argv[2];
const { openStore, isStoreOpenFailure } = await import(join(repo, "src/core/store/index.ts"));
const { StatCache, unknownStat, isUnknownStat } = await import(join(repo, "src/core/hash/index.ts"));
const dir = mkdtempSync(join(tmpdir(), "sq-011-204-store-"));
try {
  const open = () => {
    const store = openStore(dir, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    return store;
  };
  let store = open();
  const record = { path: "src/a.ts", ...unknownStat({ mtimeMs: 5, ctimeMs: 5, size: 42, inode: 7 }), hash: "a".repeat(40) };
  store.transaction(() => store.fileHashes.upsertMany("wt", [record]));
  store.close();
  store = open();
  const loaded = StatCache.load(store.fileHashes, "wt").get("src/a.ts");
  store.close();
  console.log(JSON.stringify({ stored: record, loaded, unknownAfterReload: isUnknownStat(loaded) }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
