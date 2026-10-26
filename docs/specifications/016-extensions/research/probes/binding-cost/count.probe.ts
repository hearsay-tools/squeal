// Throwaway probe for 016-34, question 3: how many RunnerAdapter calls the
// real scheduler makes per edit, split into async calls (each one a message
// on a process binding) and synchronous scheduling hints (made while
// selection holds the scheduler's lock, per runner.ts). Counts only; no
// timing. Copied by count.sh into a scratch clone at
// test/scheduler/count-probe.test.ts. Env: FILES (test files, 6),
// SHAPE ("tiers": Vitest-like, no slots; "slots": node:test-like,
// backlogSlot 1 and besideBacklog), OUT (JSON path).
// Every hint is defined, as the daemon's afterEachRun wrapper defines them
// for every adapter (src/core/daemon/escaped.ts).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { DEFAULT_POLICY, type Policy, type RunOptions, type RunReport, type TestFileRef } from "../../src/core/types/index.js";
import { RecordingSink } from "./recording-sink.js";

const N = Number(process.env.FILES ?? 6);
const SHAPE = process.env.SHAPE ?? "tiers";
const tests = Array.from({ length: N }, (_, i) => `test/t${i}.test.ts`);
const moduleOf = (t: string) => t.replace(/^test\/t(\d+)\.test\.ts$/, "src/m$1.ts");
const ref = (path: string): TestFileRef => ({ project: "", path });
const SYNC = ["lane", "tierWidth", "tierPart", "slowWidth", "besideBacklog", "backlogSlot", "focusesFile", "omittedTestFiles"];

const counts = new Map<string, number>();
const runFiles: number[] = [];
const count = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);

const runner = {
  name: "count",
  adapterVersion: "1",
  async invalidate() {
    count("invalidate");
    return { recreatedProjects: [] };
  },
  async affected(changed: readonly string[]) {
    count("affected");
    const shared = changed.includes("src/shared.ts");
    const direct = tests.filter((t) => changed.includes(t) || changed.includes(moduleOf(t)));
    const transitive = shared ? tests.filter((t) => !direct.includes(t)) : [];
    return { direct: direct.map(ref), transitive: transitive.map(ref) };
  },
  async closure(testFile: TestFileRef) {
    count("closure");
    return { testFile, paths: [testFile.path, moduleOf(testFile.path), "src/shared.ts"] };
  },
  async enumerate() {
    count("enumerate");
    return [];
  },
  async testFiles() {
    count("testFiles");
    return tests.map(ref);
  },
  async environment() {
    count("environment");
    return [{ project: "", runnerName: "count", runnerVersion: "1", adapterVersion: "1", resolvedConfig: "{}", files: ["config.json"] }];
  },
  async run(files: readonly TestFileRef[], _options: RunOptions): Promise<RunReport> {
    count("run");
    runFiles.push(files.length);
    return {
      end: "completed",
      durationMs: 1,
      completedFiles: files,
      results: files.map((t) => ({
        check: { kind: "test" as const, project: t.project, testPath: t.path, fullName: "runs" },
        outcome: "pass" as const,
        durationMs: 1,
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: null,
    } as RunReport;
  },
  async releaseLane() {
    count("releaseLane");
  },
  async close() {},
  lane: () => (count("lane"), ""),
  tierWidth: (_t: TestFileRef, grant: number) => (count("tierWidth"), grant),
  tierPart: () => (count("tierPart"), ""),
  slowWidth: (files: readonly TestFileRef[]) => (count("slowWidth"), files.length),
  besideBacklog: () => (count("besideBacklog"), SHAPE === "slots"),
  backlogSlot: () => (count("backlogSlot"), SHAPE === "slots" ? 1 : null),
  focusesFile: () => (count("focusesFile"), false),
  omittedTestFiles: () => (count("omittedTestFiles"), 0),
};


// The 016-18 probe's virtual clock (model-scheduler/model.probe.ts): the
// scheduler's timers fire when `advance` passes their deadline, so its
// quiet and catch-up waits end without real minutes.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const sleep = (ms: number) => new Promise((r) => realSetTimeout(r, ms));
class VTimer {
  h: ReturnType<typeof realSetTimeout> | null = null;
  refd = true;
  constructor(
    readonly due: number,
    readonly fn: () => void,
  ) {}
  unref() {
    this.refd = false;
    this.h?.unref?.();
    return this;
  }
  ref() {
    this.refd = true;
    this.h?.ref?.();
    return this;
  }
  hasRef() {
    return this.refd;
  }
  refresh() {
    return this;
  }
  [Symbol.toPrimitive]() {
    return 0;
  }
}
class Clock {
  offset = 0;
  readonly timers = new Set<VTimer>();
  now = () => Date.now() + this.offset;
  advance(ms: number) {
    this.offset += ms;
    const at = this.now();
    for (const t of [...this.timers])
      if (t.due <= at) {
        if (t.h !== null) realClearTimeout(t.h);
        t.h = realSetTimeout(() => this.fire(t), 0);
        if (!t.refd) t.h.unref?.();
      }
  }
  fire(t: VTimer) {
    if (!this.timers.delete(t)) return;
    t.fn();
  }
  install() {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
      const t = new VTimer(this.now() + Number(ms), () => fn(...args));
      t.h = realSetTimeout(() => this.fire(t), ms);
      this.timers.add(t);
      return t;
    };
    g.clearTimeout = (t: unknown) => {
      if (t instanceof VTimer) {
        this.timers.delete(t);
        if (t.h !== null) realClearTimeout(t.h);
      } else realClearTimeout(t as never);
    };
  }
  uninstall() {
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = realSetTimeout;
    g.clearTimeout = realClearTimeout;
    for (const t of this.timers) if (t.h !== null) realClearTimeout(t.h);
    this.timers.clear();
  }
}
const clock = new Clock();

it("counts runner calls per edit", { timeout: 300_000 }, async () => {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "bc34-count-"))), "main");
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const t of tests) {
    write(t, `import "../${moduleOf(t)}";\n`);
    write(moduleOf(t), `import "./shared.ts";\n`);
  }
  write("src/shared.ts", "// shared\n");
  write("config.json", "{}\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=c@x", "-c", "user.name=c", "commit", "-qm", "fixture"]);
  const commonDir = join(root, ".git");
  const opened = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  const store = opened;
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: true,
    registeredAt: Date.now(),
    daemon: {
      socketPath: `/tmp/bc34-none-${worktreeId}.sock`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 600_000,
      squealVersion: "0.0.0-test",
    },
  } as never);
  clock.install();
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy: {
      ...DEFAULT_POLICY,
      baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-then-run-missing" },
    } as Policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    onError: (error: Error) => {
      throw error;
    },
    now: clock.now,
  } as never);
  // Idle as the 016-18 probe's drainIdle: a virtual minute at a time.
  // Returns the virtual seconds it took.
  const idle = async () => {
    const from = clock.offset;
    let done = false;
    const idled = scheduler.idle().then(() => {
      done = true;
    });
    for (let i = 0; i < 300 && !done; i++) {
      await Promise.race([idled, sleep(50)]);
      if (!done) clock.advance(60_000);
    }
    if (!done) throw new Error("never idle");
    return (clock.offset - from) / 1000;
  };
  const snapshot = (label: string, virtualS: number) => {
    const calls = Object.fromEntries([...counts].sort());
    const syncCalls = SYNC.reduce((a, k) => a + (counts.get(k) ?? 0), 0);
    const asyncCalls = [...counts].filter(([k]) => !SYNC.includes(k)).reduce((a, [, v]) => a + v, 0);
    const line = { label, virtualS, files: N, shape: SHAPE, asyncCalls, syncCalls, runs: runFiles.length, runFiles: [...runFiles], calls };
    counts.clear();
    runFiles.length = 0;
    return line;
  };
  const out: unknown[] = [];
  await scheduler.start();
  out.push(snapshot("start and baseline", await idle()));
  const hasher = createFsHasher(root, "sha1");
  let edits = 0;
  for (const path of ["src/m0.ts", "src/m0.ts", "src/m0.ts", "src/shared.ts", "src/shared.ts", "src/shared.ts"]) {
    edits += 1;
    appendFileSync(join(root, path), `// edit ${edits}\n`);
    await scheduler.handleBatch({ trigger: "watch", paths: await statCandidates([path], hasher) } as never);
    out.push(snapshot(`edit ${path}`, await idle()));
  }
  await scheduler.close();
  clock.uninstall();
  store.close?.();
  for (const line of out) console.log(JSON.stringify(line));
  if (process.env.OUT) writeFileSync(process.env.OUT, `${out.map((l) => JSON.stringify(l)).join("\n")}\n`);
});
