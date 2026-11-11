// Throwaway (row 021-04): the remote runner host. It runs on the far side of SSH:
//   cd <squeal clone> && node --import tsx <this file> <project root>
// It builds Squeal's own Vitest adapter (createVitestAdapter) over the remote tree and
// answers one JSON request per stdin line. Every protocol line on stdout starts with MARK,
// so stray output from Vitest or a worker cannot be read as a reply.
// Requests:  {"id":1,"m":"invalidate","a":[...]}
// Replies:   MARK{"id":1,"r":...} or MARK{"id":1,"e":"message"}
// Events:    MARK{"ev":"fileEnded","testFile":...} / {"ev":"note","text":...}
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const MARK = "\u0001SQ ";
const root = process.argv[2];
const squeal = process.env.SQUEAL_SRC ?? process.cwd();
const realWrite = process.stdout.write.bind(process.stdout);
// Anything else that writes to our stdout goes to stderr instead.
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
const send = (o: unknown) => realWrite(`${MARK}${JSON.stringify(o)}\n`);

const { createVitestAdapter } = await import(join(squeal, "src/runners/vitest/index.ts"));
// The daemon runs Vitest with the worktree root as its working directory; a host must too,
// or Vite's messages name paths relative to the wrong directory (seen: "../..src/math.ts").
if (process.env.RS_KEEP_CWD !== "1") process.chdir(root);
let adapter: any = null;
const runs = new Map<number, AbortController>();

/** Git blob id (sha1 object format) of a root-relative path; null when missing. Squeal's file hash. */
function blob(rel: string): string | null {
  try {
    const bytes = readFileSync(join(root, rel));
    return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  } catch {
    return null;
  }
}

const methods: Record<string, (...a: any[]) => unknown> = {
  hello: () => ({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    root,
    ci: process.env.CI ?? null,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    vitest: JSON.parse(readFileSync(join(root, "node_modules/vitest/package.json"), "utf8")).version,
  }),
  open: async (opts: { observe?: boolean } = {}) => {
    const t = performance.now();
    adapter = await createVitestAdapter({
      root,
      observe: () => opts.observe === true,
      note: (text: string) => send({ ev: "note", text }),
      cache: false,
    });
    return { ms: Math.round(performance.now() - t), name: adapter.name, adapterVersion: adapter.adapterVersion };
  },
  invalidate: (paths) => adapter.invalidate(paths),
  affected: (paths) => adapter.affected(paths),
  closure: (ref) => adapter.closure(ref),
  enumerate: (ref) => adapter.enumerate(ref),
  testFiles: () => adapter.testFiles(),
  environment: () => adapter.environment(),
  blobs: (paths: string[]) => Object.fromEntries(paths.map((p) => [p, blob(p)])),
  run: async (files, options: { runId: string; timeoutMs: number | null }, id: number) => {
    const ac = new AbortController();
    runs.set(id, ac);
    const logDir = mkdtempSync(join(tmpdir(), "rs-run-"));
    try {
      return await adapter.run(files, {
        ...options,
        logDir,
        signal: ac.signal,
        stop: ac.signal,
        fileEnded: (testFile: unknown) => send({ ev: "fileEnded", id, testFile }),
      });
    } finally {
      runs.delete(id);
    }
  },
  cancel: (runId: number) => {
    runs.get(runId)?.abort("stop");
    return runs.has(runId);
  },
  close: async () => {
    await adapter?.close();
    setTimeout(() => process.exit(0), 10);
    return true;
  },
};

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let req: { id: number; m: string; a?: unknown[] };
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const fn = methods[req.m];
    if (!fn) throw new Error(`unknown method ${req.m}`);
    const args = req.a ?? [];
    const r = await (req.m === "run" ? fn(args[0], args[1], req.id) : fn(...args));
    send({ id: req.id, r });
  } catch (error) {
    send({ id: req.id, e: error instanceof Error ? error.message : String(error) });
  }
});
// The channel closed (the SSH connection dropped, or the daemon went away): stop every run, then exit.
rl.on("close", async () => {
  for (const ac of runs.values()) ac.abort("stop");
  try {
    await adapter?.close();
  } finally {
    process.exit(0);
  }
});
send({ ev: "ready", pid: process.pid });
