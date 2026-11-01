import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathFirst, runTurns, squealBin } from "../../evals/lib/index.mjs";
import {
  checkCodexRuntime,
  holdCodexUpdates,
  pinSqueal,
  RuntimeMoved,
  retainCodexRuntime,
} from "../../evals/lib/prepare.mjs";
import { releaseSession, selectRuntime } from "../../src/harness/codex/adapter/store.js";
import { scheduleRuntimeUpdate } from "../../src/harness/codex/runtime-update/schedule.js";
import { isDue, readUpdateState } from "../../src/harness/codex/runtime-update/state.js";
import { updateRuntime } from "../../src/harness/codex/runtime-update/update.js";
import {
  fixedPlugin,
  runtimeTree,
  write,
  writeManifest,
} from "../harness/codex/adapter/fixture.js";

// Review 006-100 B1: a cell's SessionStart scheduled a background update, which could select a
// newer released runtime; SessionEnd then released the thread's pin, and a resumed turn ran the
// newer one while the runner's CLI stayed on the pin. One runtime holds for the whole cell: the
// cell's update state holds every scheduled check off, renewed before each turn, and the cell
// fails without a grade when the runtime moved anyway. The adapter's own selection code, a fake
// transport and the shipped launcher: no model, no network, no daemon.

const LAUNCHER = join(import.meta.dirname, "../../plugins/codex/bin/squeal-launcher");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const CLI = "dist/cli/squeal.mjs";
const MIN = 60_000;

/** A runtime tree of `version` whose CLI prints its version and the file it runs from. */
function reportingRuntime(root: string, version: string): string {
  runtimeTree(root, version);
  write(join(root, CLI), `console.log(${JSON.stringify(version)}, process.argv[1]);\n`, 0o755);
  write(join(root, "bin/squeal-launcher"), readFileSync(LAUNCHER), 0o755);
  return writeManifest(root, version);
}

/** A pin of the fixed adapter's layout at 0.1.387, a cell installed from it, and 0.1.389. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "squeal-runtime-hold-"));
  dirs.push(dir);
  const pin = join(dir, "pin");
  const plugin = fixedPlugin(join(pin, "plugins/codex"), "0.1.368");
  write(join(plugin, "hooks/hooks.json"), "{}\n");
  write(join(plugin, "bin/squeal-launcher"), readFileSync(LAUNCHER), 0o755);
  reportingRuntime(join(pin, "plugins/codex-runtime"), "0.1.387");
  const cell = join(dir, "cell");
  const codexHome = join(cell, "codex");
  // `codex plugin add squeal@hearsay`: the adapter in Codex's cache, its PLUGIN_ROOT.
  const adapter = join(codexHome, "plugins/cache/hearsay/squeal/1.0.0");
  cpSync(plugin, adapter, { recursive: true });
  mkdirSync(join(cell, "home"), { recursive: true });
  const newer = reportingRuntime(join(dir, "newer"), "0.1.389");
  return {
    pin,
    cell,
    codexHome,
    adapter,
    newer,
    data: join(codexHome, "plugins/data/squeal-hearsay"),
  };
}

describe("one Codex runtime for the whole cell (review 006-100 B1)", () => {
  it("selects the pin on each turn, through an update attempt, SessionEnd, resume and the launcher", async () => {
    const { pin, cell, codexHome, adapter, data } = fixture();
    const { runtime } = pinSqueal(pin, "codex");
    if (!runtime) throw new Error("no runtime");
    const cli = retainCodexRuntime(codexHome, runtime);
    expect(isDue(readUpdateState(data), Date.now())).toBe(false);
    const bin = squealBin("codex", cell, pin);
    let clock = Date.now();
    const out = join(cell, "out");
    mkdirSync(out);
    const seen: { turn: string; hook: string; launcher: string }[] = [];
    const started: unknown[] = [];
    const fetched: string[] = [];
    const updates: string[] = [];
    const { exits } = await runTurns({
      prompts: ["first", "second"],
      harness: "codex",
      command: ({ resume }: { resume: string | null }) => [
        "codex",
        resume ? ["exec", "resume", resume] : ["exec"],
      ],
      beforeTurn: () => holdCodexUpdates(codexHome, runtime.version, clock),
      // A Codex `exec`, ten minutes into the turn: its first hook, SessionStart's update check,
      // an updater started anyway, a bare `squeal` in its shell, then SessionEnd.
      session: async (_cmd: string, args: string[], t0: number | null) => {
        const thread = args[1] === "resume" ? (args[2] ?? "") : "thread-1";
        const at = () => clock + 10 * MIN;
        const hook = selectRuntime({ pluginRoot: adapter, data, sessionId: thread });
        const env = { PLUGIN_ROOT: hook.root, PLUGIN_DATA: data, SQUEAL_ADAPTER_ROOT: adapter };
        started.push(scheduleRuntimeUpdate({ env, now: at, start: () => {} }));
        const transport = async (url: string) => {
          fetched.push(url);
          throw new Error("no network in this test");
        };
        updates.push(
          (await updateRuntime({ pluginRoot: adapter, data, now: at, transport })).outcome,
        );
        const r = spawnSync("sh", ["-c", "squeal --version"], {
          cwd: cell,
          encoding: "utf8",
          env: {
            PATH: pathFirst(`${dirname(process.execPath)}:/usr/bin:/bin`, bin),
            HOME: join(cell, "home"),
            CODEX_HOME: codexHome,
            CODEX_SESSION_ID: thread,
            XDG_DATA_HOME: join(cell, "home/.local/share"),
            XDG_STATE_HOME: join(cell, "home/.local/state"),
          },
        });
        seen.push({ turn: thread, hook: hook.version, launcher: (r.stdout + r.stderr).trim() });
        releaseSession(data, thread);
        if (!args.includes("resume"))
          appendFileSync(
            join(out, "events.jsonl"),
            `${JSON.stringify({ t: 0, type: "thread.started", thread_id: thread })}\n`,
          );
        const exit = { exit: 0, signal: null, timedOut: false, spawnError: null };
        return { exit, t0: t0 ?? clock, t1: clock, samples: [0] };
      },
      // The settle wait and the turn take most of the hold: turn 2 starts 50 minutes later.
      settle: async () => {
        clock += 50 * MIN;
        return { settled: true, why: "settled", waitedMs: 0, polls: 0, status: "" };
      },
      out,
      log: () => {},
      load: () => "0.0",
    });
    expect(exits).toHaveLength(2);
    expect(seen).toEqual([
      { turn: "thread-1", hook: "0.1.387", launcher: `0.1.387 ${cli}` },
      { turn: "thread-1", hook: "0.1.387", launcher: `0.1.387 ${cli}` },
    ]);
    expect(started).toEqual([null, null]);
    expect(updates).toEqual(["not-due", "not-due"]);
    expect(fetched).toEqual([]);
    expect(() => checkCodexRuntime(codexHome, runtime.version)).not.toThrow();
  });

  it("would have let turn 2 schedule an update without the renewal before each turn", () => {
    const { pin, codexHome, adapter, data } = fixture();
    const { runtime } = pinSqueal(pin, "codex");
    if (!runtime) throw new Error("no runtime");
    const now = Date.now();
    retainCodexRuntime(codexHome, runtime);
    const env = {
      PLUGIN_ROOT: join(data, "versions", runtime.version),
      PLUGIN_DATA: data,
      SQUEAL_ADAPTER_ROOT: adapter,
    };
    const at = (ms: number) => () => now + ms;
    expect(scheduleRuntimeUpdate({ env, now: at(58 * MIN), start: () => {} })).toBeNull();
    expect(scheduleRuntimeUpdate({ env, now: at(60 * MIN), start: () => {} })).not.toBeNull();
    holdCodexUpdates(codexHome, runtime.version, now + 50 * MIN);
    expect(scheduleRuntimeUpdate({ env, now: at(60 * MIN), start: () => {} })).toBeNull();
  });

  it.each([
    ["an update selected 0.1.389", /runtime\/current\.json names 0\.1\.389/],
    ["0.1.389 was retained beside the pin", /versions\/ also holds 0\.1\.389/],
  ])("fails the cell when %s", (what, reason) => {
    const { pin, codexHome, newer, data } = fixture();
    const { runtime } = pinSqueal(pin, "codex");
    if (!runtime) throw new Error("no runtime");
    retainCodexRuntime(codexHome, runtime);
    if (what.startsWith("an update"))
      retainCodexRuntime(codexHome, { root: newer, version: "0.1.389" });
    else cpSync(newer, join(data, "versions/0.1.389"), { recursive: true });
    let error: unknown;
    try {
      checkCodexRuntime(codexHome, runtime.version);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RuntimeMoved);
    expect((error as Error).name).toBe("RuntimeMoved");
    expect((error as Error).message).toMatch(/^the cell's Codex runtime moved off 0\.1\.387: /);
    expect((error as Error).message).toMatch(reason);
  });
});

// run-cell.mjs starts a cell as soon as it is imported, so its wiring is read, not run.
describe("run-cell.mjs holds one runtime for the cell (review 006-100 B1)", () => {
  const source = readFileSync(join(import.meta.dirname, "../../evals/bin/run-cell.mjs"), "utf8");
  const at = (s: string) => source.indexOf(s);

  it("renews the hold before each turn of a Codex cell with a retained runtime", () => {
    expect(source).toContain("const held = plugin ? pinned.runtime : null;");
    expect(source).toContain(
      'CLI = held ? retainCodexRuntime(join(CELL, "codex"), held) : pinned.cli;',
    );
    const renew = at(
      'beforeTurn: held ? () => holdCodexUpdates(join(CELL, "codex"), held.version) : undefined,',
    );
    expect(renew).toBeGreaterThan(at("await runTurns({"));
    expect(renew).toBeLessThan(at("const exit = exits.at(-1);"));
  });

  it("checks the runtime once the cell's processes are stopped, before any grade", () => {
    const check = at('if (held) checkCodexRuntime(join(CELL, "codex"), held.version);');
    expect(check).toBeGreaterThan(at("const leftovers = await stopCellLeftovers();"));
    expect(check).toBeLessThan(at('writeFileSync(join(OUT, "meta.json")'));
    expect(check).toBeLessThan(at('join(EVALS, "bin/grade.mjs")'));
  });
});
