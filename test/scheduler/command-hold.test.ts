import { describe, expect, it } from "vitest";
import { removeCommandHold } from "../../src/core/scheduler/hold-rows.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { heldFiles, hold, liveProcess, notes, settle, tokens } from "./command-hold-fixture.js";
import { rows } from "./merge-hold-fixture.js";

/*
 * Row 011-74 (011 C9 as amended 2026-10-21, "Holds", *Hold command*;
 * `tasks/011-61/design.md` R3, tests 1 to 4, 6 and 7 at the scheduler): while
 * an entry of the worktree's command-hold row holds, the scheduler cancels
 * the tiers in flight whose runner cancels and starts none; edits are
 * recorded and queued. The removal of the last entry, its holder's death or
 * its `until` starts the queued work. `commandHold` is what the daemon calls
 * at a `hold` or `resume` request and at each heartbeat.
 */

const pendingOf = (side: Parameters<typeof rows>[0], paths: readonly string[]) =>
  paths.map((path) => rows(side).get(path)?.pending ?? null);

describe("scheduler: the command hold (row 011-74)", { timeout: 60_000 }, () => {
  it("1: a hold cancels the Vitest tier in flight within 2 s and keeps its files queued; an edit records a revision and starts nothing; the end runs the queue", async () => {
    const files = heldFiles(4, 3_000);
    const paths = files.map((f) => f.path);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    const command = await liveProcess();
    await side.scheduler.start();
    await expect.poll(() => side.runner.active).toBe(1);
    const run = side.runner.runs[0];

    const entry = hold(side, command.identity);
    const began = performance.now();
    expect(await side.scheduler.commandHold()).toBe(true);
    expect(performance.now() - began).toBeLessThan(2_000);
    expect(run?.cancelled).toBe(true);
    expect(run?.completed).toEqual([]);
    expect(pendingOf(side, paths)).toEqual(paths.map(() => "queued"));
    expect(side.scheduler.inUse()).toBe(false);

    const runs = side.runner.runs.length;
    const revision = side.scheduler.status().revision;
    await side.edit("watch", "src/held.ts");
    await side.scheduler.idle();
    await settle();
    expect(side.scheduler.status().revision).toBe(revision + 1);
    expect(side.runner.runs.length).toBe(runs);
    expect(side.scheduler.queued()).toBe(4);

    expect(removeCommandHold(side.store, side.worktreeId, entry.token)).toEqual([]);
    expect(await side.scheduler.commandHold()).toBe(false);
    await expect
      .poll(() => paths.every((path) => side.current(path)), { timeout: 30_000 })
      .toBe(true);
    expect(side.runner.runs.length).toBe(runs + 1);
  });

  it("a slot in flight runs its file to its end and no slot starts after it, as node:test's and pytest's", async () => {
    const files = heldFiles(2, 1_500);
    const [first, second] = files.map((f) => f.path);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 4,
      policy: RUN_MISSING,
      tierSize: 1,
      cancels: false,
      backlogSlot: () => 1,
    });
    const command = await liveProcess();
    await side.scheduler.start();
    await expect.poll(() => side.runner.active).toBe(1);
    const slot = side.runner.runs[0];
    const ran = slot?.files[0]?.path;

    const entry = hold(side, command.identity);
    expect(await side.scheduler.commandHold()).toBe(true);
    await expect.poll(() => slot?.endedAt !== null, { timeout: 10_000 }).toBe(true);
    await side.scheduler.idle();
    await settle(2_000);
    expect(slot?.cancelled).toBe(false);
    expect(side.current(ran ?? "")).toBe(true);
    expect(side.runner.runs).toHaveLength(1);

    removeCommandHold(side.store, side.worktreeId, entry.token);
    await side.scheduler.commandHold();
    const other = ran === first ? second : first;
    await expect.poll(() => side.current(other ?? ""), { timeout: 30_000 }).toBe(true);
  });

  it("2: with its wrapper gone and its command alive the hold holds; once the command is gone the next check removes it with one note", async () => {
    const files = heldFiles(2, 0);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();
    const wrapper = await liveProcess();
    const command = await liveProcess();
    hold(side, command.identity, { wrapper: wrapper.identity });
    expect(await side.scheduler.commandHold()).toBe(true);

    await wrapper.end();
    expect(await side.scheduler.commandHold()).toBe(true);
    await side.edit("watch", "src/held.ts");
    await settle();
    expect(side.runner.runs).toHaveLength(1);

    await command.end();
    expect(await side.scheduler.commandHold()).toBe(false);
    expect(tokens(side)).toEqual([]);
    expect(notes(side)).toContain(
      `the hold for \`npm run gate\` (pid ${command.identity.pid}) ended: its command is gone; validating again`,
    );
    await expect.poll(() => side.runner.runs.length, { timeout: 10_000 }).toBe(2);
  });

  it("3: a scheduler that starts while an entry holds starts on hold, and resumes at the entry's removal", async () => {
    const files = heldFiles(2, 0);
    const paths = files.map((f) => f.path);
    const repo = catchUpRepo(files);
    const first = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    await first.scheduler.start();
    await first.scheduler.idle();
    const command = await liveProcess();
    const entry = hold(first, command.identity);
    expect(await first.scheduler.commandHold()).toBe(true);
    await first.edit("watch", "src/held.ts");
    await first.scheduler.idle();
    expect(first.runner.runs).toHaveLength(1);
    await first.scheduler.close();

    const next = catchUpSide(repo, repo.main, { files, hostSlots: 4 });
    await next.scheduler.start();
    await next.scheduler.idle();
    await settle();
    expect(next.runner.runs).toHaveLength(0);
    expect(pendingOf(next, paths)).toEqual(paths.map(() => "queued"));

    removeCommandHold(next.store, next.worktreeId, entry.token);
    expect(await next.scheduler.commandHold()).toBe(false);
    await expect
      .poll(() => paths.every((path) => next.current(path)), { timeout: 10_000 })
      .toBe(true);
  });

  it("4: an entry past its `until` ends at its bound with one note; its later removal changes nothing", async () => {
    const files = heldFiles(2, 0);
    const paths = files.map((f) => f.path);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();
    const command = await liveProcess();
    const entry = hold(side, command.identity, { ms: 2_000 });
    expect(await side.scheduler.commandHold()).toBe(true);
    await side.edit("watch", "src/held.ts");
    await settle();
    expect(side.runner.runs).toHaveLength(1);

    await expect.poll(() => tokens(side), { timeout: 5_000, interval: 20 }).toEqual([]);
    const ended = Date.now() - entry.since;
    expect(ended).toBeGreaterThanOrEqual(2_000);
    expect(ended).toBeLessThan(3_000);
    await expect
      .poll(() => paths.every((path) => side.current(path)), { timeout: 10_000 })
      .toBe(true);
    const note = `the hold for \`npm run gate\` (pid ${command.identity.pid}) passed its 2 s bound; validating again`;
    expect(notes(side).filter((n) => n.startsWith("the hold for"))).toEqual([note]);

    expect(removeCommandHold(side.store, side.worktreeId, entry.token)).toBeNull();
    expect(await side.scheduler.commandHold()).toBe(false);
    expect(notes(side).filter((n) => n.startsWith("the hold for"))).toEqual([note]);
    expect(side.runner.runs).toHaveLength(2);
  });

  it("6: with two entries the hold ends when the second goes", async () => {
    const files = heldFiles(2, 0);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();
    const one = hold(side, (await liveProcess()).identity, { command: "npm run lint" });
    const two = hold(side, (await liveProcess()).identity, { command: "npm test" });
    expect(await side.scheduler.commandHold()).toBe(true);
    await side.edit("watch", "src/held.ts");

    removeCommandHold(side.store, side.worktreeId, one.token);
    expect(await side.scheduler.commandHold()).toBe(true);
    await settle();
    expect(side.runner.runs).toHaveLength(1);

    removeCommandHold(side.store, side.worktreeId, two.token);
    expect(await side.scheduler.commandHold()).toBe(false);
    await expect.poll(() => side.runner.runs.length, { timeout: 10_000 }).toBe(2);
  });

  it("7: a holder whose PID names a process of another start time is removed at the next check", async () => {
    const files = heldFiles(2, 0);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4 });
    await side.scheduler.start();
    await side.scheduler.idle();
    const live = await liveProcess();
    const reused = { ...live.identity, startTime: live.identity.startTime + 1 };
    hold(side, reused, { wrapper: reused });

    expect(await side.scheduler.commandHold()).toBe(false);
    expect(tokens(side)).toEqual([]);
    expect(notes(side)).toContain(
      `the hold for \`npm run gate\` (pid ${live.identity.pid}) ended: its command is gone; validating again`,
    );
  });
});
