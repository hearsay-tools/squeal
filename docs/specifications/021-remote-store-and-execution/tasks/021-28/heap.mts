/*
 * Row 021-28's heap probe (throwaway; not product code, not a test). The
 * live heap of one worktree's keys (`WorktreeKeys`: stat cache, key index,
 * kept closures) after every test file's closure is set, as a daemon holds
 * them once it has keyed every file, at a given source tree.
 *
 *   export:  tsx heap.mts export <store.sqlite> <worktree-id> <clone> <out.jsonl>
 *            Reads the worktree's stored import walks at its current keys
 *            (read-only), and writes one runner closure per line: `paths`,
 *            and `imports` with the sha1 of each file's bytes in <clone>.
 *   measure: node --expose-gc --import tsx heap.mts measure <src> <clone> <walks.jsonl> <scratch>
 *            Keys <clone> with the `WorktreeKeys` of <src> and a new store
 *            under <scratch>, sets every closure from its own JSON line (as
 *            the host's line protocol gives them: separate strings each),
 *            and prints the heap in use after a full GC before and after,
 *            and a digest of every key.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";

const [mode, ...args] = process.argv.slice(2);

function exportWalks(database: string, worktreeId: string, clone: string, out: string): void {
  const db = new DatabaseSync(database, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT k.project, k.path, i.imports FROM test_file_keys k
       JOIN test_file_imports i ON i.project = k.project AND i.path = k.path AND i.key = k.key
       WHERE k.worktree_id = ? ORDER BY k.project, k.path`,
    )
    .all(worktreeId) as { project: string; path: string; imports: Uint8Array }[];
  const sha1 = new Map<string, string>();
  const sha1Of = (path: string) => {
    let hash = sha1.get(path);
    if (hash === undefined) {
      const file = join(clone, path);
      hash = existsSync(file)
        ? createHash("sha1").update(readFileSync(file)).digest("hex")
        : "0".repeat(40);
      sha1.set(path, hash);
    }
    return hash;
  };
  const lines = rows.map(({ project, path, imports }) => {
    const walk = JSON.parse(inflateRawSync(imports).toString()) as [string, string[], string[]][];
    const paths = new Set<string>([path]);
    for (const [from, s, d] of walk) for (const p of [from, ...s, ...d]) paths.add(p);
    return JSON.stringify({
      testFile: { project, path },
      paths: [...paths].sort(),
      imports: walk.map(([from, s, d]) => ({ path: from, sha1: sha1Of(from), static: s, dynamic: d })),
    });
  });
  writeFileSync(out, `${lines.join("\n")}\n`);
  const records = rows.reduce((n, r) => n + JSON.parse(inflateRawSync(r.imports).toString()).length, 0);
  console.log(JSON.stringify({ testFiles: rows.length, records, distinctFiles: sha1.size }));
}

async function settledHeap(): Promise<number> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("run with --expose-gc");
  for (let i = 0; i < 4; i++) {
    gc();
    await new Promise((done) => setImmediate(done));
  }
  return process.memoryUsage().heapUsed;
}

async function measure(src: string, clone: string, walks: string, scratch: string): Promise<void> {
  const { WorktreeKeys } = await import(join(src, "core/scheduler/keying.ts"));
  const { openStore } = await import(join(src, "core/store/open.ts"));
  const { readHead } = await import(join(src, "core/daemon-loop/head.ts"));
  const { createFsHasher } = await import(join(src, "core/hash/hasher.ts"));
  const { worktreeIdFor } = await import(join(src, "core/fs/git-layout.ts"));
  const { DEFAULT_POLICY } = await import(join(src, "core/types/policy.ts"));
  const common = join(scratch, "common");
  mkdirSync(common, { recursive: true });
  const store = openStore(common, { busyTimeoutMs: 10_000 });
  if ("reason" in store) throw new Error(`store: ${JSON.stringify(store)}`);
  const keys = new WorktreeKeys({
    root: clone,
    worktreeId: worktreeIdFor(clone),
    store,
    hasher: createFsHasher(clone, "sha1"),
    objectFormat: "sha1",
    policy: { ...DEFAULT_POLICY, observe: { runtimeInputs: false } },
    squealVersion: "0.0.0-probe",
    env: {},
    onExtraFiles: () => {},
  });
  await keys.bootstrap(() => readHead(clone));
  await keys.setEnvironments([
    {
      project: "",
      runnerName: "vitest",
      runnerVersion: "0",
      adapterVersion: "0",
      resolvedConfig: "{}",
      files: [],
    },
  ]);
  const before = await settledHeap();
  const lines = readFileSync(walks, "utf8").split("\n").filter(Boolean);
  const refs: { project: string; path: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const closure = JSON.parse(lines[i] as string);
    refs.push(closure.testFile);
    keys.setClosure(closure);
  }
  lines.length = 0;
  await keys.trackUntracked();
  const after = await settledHeap();
  const keyed = refs.map((ref) => `${ref.path}\0${keys.index.key(ref)}`);
  const digest = createHash("sha256").update(keyed.join("\n")).digest("hex").slice(0, 16);
  const MiB = (n: number) => Math.round((n / 2 ** 20) * 10) / 10;
  console.log(
    JSON.stringify({
      src,
      testFiles: refs.length,
      keyed: refs.filter((ref) => keys.index.key(ref) !== null).length,
      keysDigest: digest,
      heapBeforeClosuresMiB: MiB(before),
      heapAfterClosuresMiB: MiB(after),
      closuresMiB: MiB(after - before),
    }),
  );
  store.close();
}

if (mode === "export") exportWalks(args[0] as string, args[1] as string, args[2] as string, args[3] as string);
else if (mode === "measure")
  await measure(args[0] as string, args[1] as string, args[2] as string, args[3] as string);
else throw new Error("usage: heap.mts export|measure ...");
