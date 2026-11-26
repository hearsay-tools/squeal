import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type SlotPool,
  slotPool,
  worktreeSlotToken,
} from "../../../../src/core/runner-host/slots.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import type { TestFileRef } from "../../../../src/core/types/keys.js";
import type { PytestProject } from "../../../../src/core/types/policy.js";
import {
  environmentHash,
  pytestVariables,
  runEnvironment,
} from "../../../../src/runners/pytest/environment/hash.js";
import {
  type PytestRunOptions,
  pytestRuntimeDir,
  runPytest,
} from "../../../../src/runners/pytest/run/run.js";

/*
 * Spec 027 D1, D2 (row 027-02): each pytest batch runs in a slot of its
 * own. A fake Python records the slot variables and the project's expanded
 * `env`, and marks its slot taken while it runs, so two batches in one slot
 * at once show as a collision.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-slots-"))) as AbsolutePath;
afterAll(() => rmSync(root, { recursive: true, force: true }));

const FILES = ["a", "b", "c", "d"].map((n) => `tests/test_${n}.py`);
mkdirSync(join(root, "tests"), { recursive: true });
for (const path of FILES) writeFileSync(join(root, path), "");
mkdirSync(join(root, "env", "bin"), { recursive: true });
const python = join(root, "env", "bin", "python") as AbsolutePath;
writeFileSync(
  python,
  [
    "#!/bin/sh",
    'out="$SQUEAL_PYTEST_EVENTS.slot"',
    'mkdir "$FAKE_LOCKS/slot-$SQUEAL_SLOT" 2>/dev/null || echo "$SQUEAL_SLOT" >> "$FAKE_LOCKS/collisions"',
    'touch "$FAKE_LOCKS/run-$$"',
    "{",
    '  echo "SQUEAL_SLOT=$SQUEAL_SLOT"',
    '  echo "SQUEAL_WORKTREE_SLOT=$SQUEAL_WORKTREE_SLOT"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell default, not a template.
    '  echo "TOX_PARALLEL_ENV=${TOX_PARALLEL_ENV-unset}"',
    '  echo "REDIS=$REDIS"',
    '  echo "DB=$DB"',
    '  echo "PLAIN=$PLAIN"',
    '  echo "PATH=$PATH"',
    '  echo "PYTHONPATH=$PYTHONPATH"',
    '  echo "RUNNING=$(ls "$FAKE_LOCKS" | grep -c \'^run-\')"',
    '} > "$out"',
    "echo ready",
    'sleep "$FAKE_SLEEP" & wait',
    'rm -f "$FAKE_LOCKS/run-$$"',
    'rmdir "$FAKE_LOCKS/slot-$SQUEAL_SLOT"',
    "",
  ].join("\n"),
);
chmodSync(python, 0o755);

const ENV = {
  REDIS: "redis://127.0.0.1:6379/{slot}",
  DB: '{"dbname":"workers_test_{worktreeSlot}","n":{slot0}}',
  PLAIN: "{not-a-slot}",
};
const project = (
  name: string,
  slots?: PytestProject["slots"],
  env: Readonly<Record<string, string>> = ENV,
): PytestProject => ({
  name,
  args: [],
  env,
  include: ["tests/test_*.py"],
  ...(slots === undefined ? {} : { slots }),
});
const refs = (name: string): TestFileRef[] => FILES.map((path) => ({ project: name, path }));

interface Seen {
  readonly vars: Readonly<Record<string, string>>;
}

function start(p: PytestProject, sleep: number, extra: Partial<PytestRunOptions> = {}) {
  const logDir = join(root, "logs", randomUUID()) as AbsolutePath;
  const locks = join(root, "locks", randomUUID());
  mkdirSync(locks, { recursive: true });
  const run = runPytest({
    root,
    project: p,
    environment: {
      discovery: { kind: "found", source: "venv", env: join(root, "env") as AbsolutePath, python },
      config: null,
      plugins: [],
      runEnv: runEnvironment(join(root, "env") as AbsolutePath, p, { PATH: process.env.PATH }),
    },
    files: refs(p.name),
    logDir,
    timeoutMs: null,
    batchSize: 1,
    concurrency: 4,
    cacheDir: join(root, "cache", p.name) as AbsolutePath,
    childEnv: { FAKE_LOCKS: locks, FAKE_SLEEP: String(sleep) },
    ...extra,
  });
  const seen = (): Seen[] =>
    readdirSync(logDir)
      .filter((f) => f.endsWith(".slot"))
      .map((f) => ({
        vars: Object.fromEntries(
          readFileSync(join(logDir, f), "utf8")
            .trim()
            .split("\n")
            .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
        ),
      }));
  const collisions = () => {
    const file = join(locks, "collisions");
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
  };
  return { run, seen, collisions, logDir };
}

const RUNTIME = pytestRuntimeDir();
const BIN = join(root, "env", "bin");
/** The project's own `PATH` and `PYTHONPATH`, each with a slot-local entry (B2 of review 0.1.642). */
const PATHS = {
  ...ENV,
  PATH: `${process.env.PATH}${delimiter}/tools/{slot}`,
  PYTHONPATH: ["/modules/{slot0}", "/gen/{worktreeSlot}"].join(delimiter),
};

const slotsOf = (seen: readonly Seen[]) => seen.map((s) => Number(s.vars.SQUEAL_SLOT)).sort();
const token = worktreeSlotToken(root);

/** The slots among `1..upTo` that `pool` holds now: every free one is taken, then given back. */
async function heldOf(pool: SlotPool, upTo: number): Promise<number[]> {
  const taken: number[] = [];
  for (let slot = await pool.acquire(AbortSignal.timeout(50)); slot !== null; ) {
    taken.push(slot);
    slot = slot > upTo ? null : await pool.acquire(AbortSignal.timeout(50));
  }
  for (const slot of taken) pool.release(slot);
  return Array.from({ length: upTo }, (_, i) => i + 1).filter((n) => !taken.includes(n));
}

describe("runPytest's per-batch slots (spec 027 D1, D2)", () => {
  it("gives concurrent batches distinct slots 1..N with expanded env, and releases them", async () => {
    const { run, seen, collisions } = start(project("plain"), 0.5);
    await run;
    expect(collisions()).toEqual([]);
    expect(slotsOf(seen())).toEqual([1, 2, 3, 4]);
    for (const { vars } of seen()) {
      const slot = Number(vars.SQUEAL_SLOT);
      expect(vars).toEqual({
        SQUEAL_SLOT: String(slot),
        SQUEAL_WORKTREE_SLOT: `${token}_${slot}`,
        TOX_PARALLEL_ENV: "unset",
        REDIS: `redis://127.0.0.1:6379/${slot}`,
        DB: `{"dbname":"workers_test_${token}_${slot}","n":${slot - 1}}`,
        PLAIN: "{not-a-slot}",
        PATH: expect.any(String),
        PYTHONPATH: RUNTIME,
        RUNNING: expect.any(String),
      });
    }
    expect(await heldOf(slotPool(root, "plain"), 4)).toEqual([]);
  });

  it("exports TOX_PARALLEL_ENV as the worktree slot when slots.toxParallelEnv is true", async () => {
    const { run, seen } = start(project("tox", { toxParallelEnv: true }), 0.2);
    await run;
    for (const { vars } of seen()) expect(vars.TOX_PARALLEL_ENV).toBe(vars.SQUEAL_WORKTREE_SLOT);
    expect(seen()).toHaveLength(4);
  });

  it("caps batches at once to slots.max and never gives a slot above it", async () => {
    const { run, seen, collisions } = start(project("capped", { max: 2 }), 0.3);
    await run;
    expect(collisions()).toEqual([]);
    expect(seen()).toHaveLength(4);
    expect(new Set(slotsOf(seen()))).toEqual(new Set([1, 2]));
    for (const { vars } of seen()) expect(Number(vars.RUNNING)).toBeLessThanOrEqual(2);
    expect(await heldOf(slotPool(root, "capped"), 4)).toEqual([]);
  });

  it("never gives two runs of one project at once the same slot", async () => {
    const shared = project("shared");
    const one = start(shared, 0.5, { files: refs("shared").slice(0, 2) });
    const two = start(shared, 0.5, { files: refs("shared").slice(2) });
    await Promise.all([one.run, two.run]);
    expect(slotsOf([...one.seen(), ...two.seen()])).toEqual([1, 2, 3, 4]);
    expect(await heldOf(slotPool(root, "shared"), 4)).toEqual([]);
  });

  it("releases the slots of batches a stop's SIGTERM ended", async () => {
    const stop = new AbortController();
    const { run, seen } = start(project("stopped"), 30, { signal: stop.signal });
    for (let waited = 0; seen().length < 4; waited += 20) {
      if (waited > 20_000) throw new Error("the fake python never started");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await heldOf(slotPool(root, "stopped"), 4)).toEqual([1, 2, 3, 4]);
    stop.abort();
    const { report } = await run;
    expect(report.end).toBe("completed");
    expect(await heldOf(slotPool(root, "stopped"), 4)).toEqual([]);
  });

  it("keys every slot alike: the environment hash reads the unexpanded templates", () => {
    const env = join(root, "env") as AbsolutePath;
    const p = project("keyed");
    const runEnv = runEnvironment(env, p, { PATH: "/usr/bin" });
    expect(runEnv.REDIS).toBe(ENV.REDIS);
    const inputs = {
      root,
      files: { pyvenvCfg: null, interpreter: null, siteEntries: [], pth: [], directUrls: [] },
      interpreter: {
        realPath: python,
        version: "3.12.0",
        implementation: "cpython",
        cacheTag: "cpython-312",
      },
      config: null,
      configText: null,
      variables: pytestVariables(runEnv),
    };
    const hash = environmentHash({ ...inputs, project: p });
    // A hash of what one slot's batch sees differs, so the template is what keeps slots alike.
    const slotOne = { ...p, env: { ...ENV, REDIS: "redis://127.0.0.1:6379/1" } };
    expect(environmentHash({ ...inputs, project: slotOne })).not.toBe(hash);
    expect(environmentHash({ ...inputs, project: project("keyed", { max: 3 }) })).toBe(hash);
  });
  it("expands PATH and PYTHONPATH templates behind the env's bin and before the runtime directory", async () => {
    const { run, seen } = start(project("paths", undefined, PATHS), 0);
    await run;
    expect(slotsOf(seen())).toEqual([1, 2, 3, 4]);
    for (const { vars } of seen()) {
      const slot = Number(vars.SQUEAL_SLOT);
      expect(vars.PATH).toBe([BIN, process.env.PATH, `/tools/${slot}`].join(delimiter));
      expect(vars.PYTHONPATH).toBe(
        [`/modules/${slot - 1}`, `/gen/${token}_${slot}`, RUNTIME].join(delimiter),
      );
      expect(vars.REDIS).toBe(`redis://127.0.0.1:6379/${slot}`);
    }
  });

  it("lets an explicit childEnv override the project's env, PATH and PYTHONPATH too", async () => {
    const locks = join(root, "locks", randomUUID());
    mkdirSync(locks, { recursive: true });
    const PATH = `${process.env.PATH}${delimiter}/child/{slot}`;
    const { run, seen } = start(project("child", undefined, PATHS), 0, {
      childEnv: {
        FAKE_LOCKS: locks,
        FAKE_SLEEP: "0",
        PLAIN: "child {slot}",
        PATH,
        PYTHONPATH: "/child/{slot}",
      },
    });
    await run;
    expect(seen()).toHaveLength(4);
    for (const { vars } of seen()) {
      expect(vars.PLAIN).toBe("child {slot}");
      expect(vars.PATH).toBe(PATH);
      expect(vars.PYTHONPATH).toBe(["/child/{slot}", RUNTIME].join(delimiter));
      expect(vars.REDIS).toBe(`redis://127.0.0.1:6379/${vars.SQUEAL_SLOT}`);
    }
  });
});
