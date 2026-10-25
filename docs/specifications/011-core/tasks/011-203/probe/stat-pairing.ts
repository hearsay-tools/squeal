// Row 011-203 evidence: one write before a run reads as a touch when a pass pairs a pre-write stat with post-write bytes.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const repo = process.argv[2];
const { createFsHasher } = await import(join(repo, "src/core/hash/hasher.ts"));
const { StatCache } = await import(join(repo, "src/core/hash/stat-cache.ts"));
const { diffCandidates } = await import(join(repo, "src/core/revision/reconcile.ts"));
const { touchedUnchanged } = await import(join(repo, "src/core/scheduler/stability.ts"));

async function scenario(statBeforeWrite: boolean) {
  const root = mkdtempSync(join(tmpdir(), "sq-011-203-probe-"));
  try {
    const path = "test/held.test.ts";
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, path), "it();\n");
    const hasher = createFsHasher(root, "sha1");
    const cache = new StatCache();
    const apply = (d: { updates: any[] }) => {
      for (const u of d.updates) if (u.kind === "set") cache.set(u.record, { racy: u.racy });
    };
    // The daemon's first look, within 2 s of the fixture's creation: racy.
    apply(await diffCandidates([{ path, stat: await hasher.stat(path) }], cache, hasher));
    const racy = cache.isRacy(path);
    const before = await hasher.stat(path);
    appendFileSync(join(root, path), "// edited\n"); // the fixture's one write
    const first = await diffCandidates(
      [{ path, stat: statBeforeWrite ? before : await hasher.stat(path) }],
      cache,
      hasher,
    );
    const t1 = touchedUnchanged(first, cache);
    apply(first);
    // The write's own watch batch, stat'ed after the write.
    const second = await diffCandidates([{ path, stat: await hasher.stat(path) }], cache, hasher);
    const t2 = touchedUnchanged(second, cache);
    console.log(
      JSON.stringify({
        statBeforeWrite,
        racyAtWrite: racy,
        firstPass: { changes: first.changes.map((c: any) => c.path), touched: t1 },
        writesOwnBatch: { changes: second.changes.map((c: any) => c.path), touched: t2 },
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
await scenario(false);
await scenario(true);
