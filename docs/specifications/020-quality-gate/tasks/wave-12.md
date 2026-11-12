# Wave 12: row 020-37, the busy note names the lock holder under load

Use /worker. Shape: repair. Board row 020-37; evidence `tasks/020-29-30/notes.md` (the failing run at load 72); spec 020 D17.5; spec 021 D5.

Outcome: when the store refused a write, the gate's busy note names the process holding the write lock whenever one holds it, also under heavy load.

Start: `holderOf` in `src/core/code/gate/keep-write.ts` reads `/proc/locks` once through `lockHolders`/`describeHolders` (`src/core/store/lock-holders.ts`). Lead: when the write was refused and the first read names no holder, read again a few times with a short pause (bounded, for example 3 reads within 100 ms), outside any transaction. Keep spec 021's rule: never open or close a descriptor of `store.sqlite`, `-wal` or `-shm` while this process holds a connection; read only through `lockHolders`.

Owns: `keep-write.ts` (`holderOf` only), `src/core/store/lock-holders.ts` if the retry belongs there (spec 021's coordinator 52f4f62a agreed), their tests, `test/code/gate/keep-busy.test.ts`. Leave alone: `keep.ts`, `keep-expected.ts` and the run-evidence files (spec 011 row 011-319, coordinator bef76bfb), `keep-sent.ts`, `keep-here.ts`.

Done when: a unit test where the first lock read misses and a later one finds the holder names it; the two keep-busy cases pass 20 runs in a row on Node 24 and on Node 26 at the host's real load (state it); lint, typecheck, `squeal status --wait 60000` on the changed paths. No build, no full suite.
