import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { type CancelSignals, runCommand } from "../../../src/core/code/gate/command.js";
import { alive, beats, gone, PREPARE_SCRIPT, pidsOf } from "./prepare-cancel-kit.js";

/*
 * Review 0.1.432 B1 (spec 020 D15.3, D3.4): the process that runs a
 * `prepare` command owns its process group. On SIGINT or SIGTERM it kills
 * the group, then lets the signal take its own action; the command's
 * listeners go when it settles. Here an emitter stands in for `process`,
 * and `raise` records the signal instead of ending the test's process.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-prepare-cancel-")));
  dirs.push(dir);
  writeFileSync(join(dir, "prepare.cjs"), PREPARE_SCRIPT);
  return dir;
}

/** `process`'s signals, as a test's emitter: `raise` records what it was given, and whether `pids` still ran. */
class Signals extends EventEmitter implements CancelSignals {
  readonly raised: { readonly signal: NodeJS.Signals; readonly running: boolean }[] = [];
  constructor(
    private readonly pids: () => readonly number[],
    private readonly order: string[] = [],
  ) {
    super();
  }
  raise(signal: NodeJS.Signals): void {
    this.order.push(`raised ${signal}`);
    this.raised.push({ signal, running: this.pids().some(alive) });
  }
}

const run = (cwd: string, signals: CancelSignals, timeoutMs = 60_000) =>
  runCommand([process.execPath, "prepare.cjs"], {
    cwd,
    env: process.env,
    timeoutMs,
    output: () => {},
    signals,
  });

describe("runCommand: cancelled with the gate (review 0.1.432 B1)", () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`kills the command and its descendant on ${signal}, then gives the signal its own action`, async () => {
      const dir = scratch();
      let pids: readonly number[] = [];
      const order: string[] = [];
      const signals = new Signals(() => pids, order);

      const ran = run(dir, signals).then((ended) => {
        order.push("settled");
        return ended;
      });
      const started = await pidsOf(dir, 20_000);
      pids = [started.prepare, started.child];
      expect(signals.listenerCount(signal)).toBe(1);
      signals.emit(signal);
      const ended = await ran;

      expect(signals.raised).toEqual([{ signal, running: false }]);
      expect(order).toEqual([`raised ${signal}`, "settled"]);
      expect(ended).toMatchObject({ cancelled: signal, timedOut: false });
      expect(await gone(pids)).toBe(true);
      const at = beats(dir);
      await delay(300);
      expect(beats(dir)).toEqual(at);
      expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    });
  }

  it("listens only while the command runs", async () => {
    const dir = scratch();
    const signals = new Signals(() => []);
    const ended = await runCommand([process.execPath, "-e", "process.exit(0)"], {
      cwd: dir,
      env: process.env,
      timeoutMs: 60_000,
      output: () => {},
      signals,
    });

    expect(ended).toMatchObject({ code: 0, timedOut: false });
    expect(ended.cancelled).toBeUndefined();
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    await run(dir, signals, 0);
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.raised).toEqual([]);
  });
});
