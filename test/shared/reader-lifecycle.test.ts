import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { publish, readerOf, scratch } from "./reader-kit.js";
import { cloneOf, cloneWith, git, type Scratch } from "./remote.js";

/*
 * Spec 018 D14 (row 018-20 R1, review `wave-5-0.1.422.md` B1 and B2): a stop
 * at any point of the reader's work starts no git afterwards, and the reader
 * takes a new nearest main commit when the remote's default branch moved
 * while `HEAD` did not. A `git` first on `PATH` logs each call and can hold
 * one until the test releases it; every call then runs the real git.
 */

interface GitSpy {
  /** The calls so far, one line each, with the test's marks between them. */
  readonly calls: () => string[];
  /** Resolves once the held call started. */
  readonly held: () => Promise<void>;
  readonly release: () => void;
  readonly mark: (text: string) => void;
}

/** Puts a logging `git` first on `PATH` until the test finishes; `hold` is a shell pattern of the call to hold. */
function spyGit(s: Scratch, hold: string | null): GitSpy {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(s.dir, "bin");
  mkdirSync(bin);
  const log = join(s.dir, "git.log");
  const started = join(s.dir, "held");
  const released = join(s.dir, "released");
  writeFileSync(log, "");
  const gate =
    hold === null
      ? ""
      : `case "$*" in ${hold}) : > '${started}'; while [ ! -f '${released}' ]; do sleep 0.02; done;; esac\n`;
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n${gate}exec '${real}' "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path ?? ""}`;
  onTestFinished(() => {
    process.env.PATH = path;
    writeFileSync(released, "");
  });
  return {
    calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
    held: async () => {
      for (const until = Date.now() + 10_000; !existsSync(started); ) {
        if (Date.now() > until) throw new Error("the held git call never started");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    release: () => writeFileSync(released, ""),
    mark: (text) => appendFileSync(log, `${text}\n`),
  };
}

/** The calls after `mark`. */
const callsAfter = (calls: string[], mark: string) => calls.slice(calls.indexOf(mark) + 1);

/** A clone at main's one commit, whose export the remote holds. */
async function publishedClone(s: Scratch): Promise<{ dev: string; c0: string }> {
  const ci = cloneWith(s, "ci", 1);
  const [c0] = ci.commits as [string];
  await publish(ci.root, c0);
  return { dev: cloneOf(s, "dev"), c0 };
}

describe("the shared results reader stopped (018 D14, R1 B1)", () => {
  it("starts no git after a stop right after the nudge", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    const { reader, commits } = readerOf(dev);
    const spy = spyGit(s, null);
    reader.nudge();
    reader.close();
    await reader.idle();
    expect(spy.calls()).toEqual([]);
    expect(commits()).toEqual([]);
  });

  it("starts no fetch after a stop during the first-parent check", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    const { reader, commits, notes } = readerOf(dev);
    const spy = spyGit(s, `"rev-list --first-parent refs/remotes/origin/main --not "*`);
    reader.nudge();
    await spy.held();
    reader.close();
    spy.mark("closed");
    spy.release();
    await reader.idle();
    expect(callsAfter(spy.calls(), "closed")).toEqual([]);
    expect(spy.calls().some((c) => c.startsWith("ls-remote "))).toBe(true);
    expect(commits()).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("kills the fetch in flight at a stop, without waiting for its kill timer", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    const { reader, commits, notes } = readerOf(dev, { fetchTimeoutMs: 20_000 });
    const spy = spyGit(s, `"fetch "*`);
    reader.nudge();
    await spy.held();
    const stopped = Date.now();
    reader.close();
    spy.mark("closed");
    await reader.idle();
    expect(Date.now() - stopped).toBeLessThan(2_000);
    spy.release();
    expect(callsAfter(spy.calls(), "closed")).toEqual([]);
    expect(commits()).toEqual([]);
    expect(notes).toEqual([]);
  });
});

/** Whether the reader went idle within `ms`, without waiting longer. */
async function idleWithin(reader: { idle: () => Promise<void> }, ms: number): Promise<boolean> {
  const late = new Promise<false>((resolve) => setTimeout(resolve, ms, false));
  return Promise.race([reader.idle().then(() => true as const), late]);
}

/**
 * A clone whose refs the git dir cannot resolve, as in a reftable
 * repository: git 2.43 makes none, so its `reftable/` directory and an
 * unresolved `HEAD` stand in for one.
 */
function reftableLike(dev: string): void {
  git(dev, ["checkout", "-q", "--orphan", "unborn"]);
  mkdirSync(join(dev, ".git", "reftable"));
}

describe("the shared results reader's local git stopped and bounded (018-23, review 0.1.422-r2 N1)", () => {
  it("kills the commit listing in flight at a stop", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    const { reader, commits, notes } = readerOf(dev);
    const spy = spyGit(s, `"ls-tree "*`);
    reader.nudge();
    await spy.held();
    reader.close();
    spy.mark("closed");
    expect(await idleWithin(reader, 2_000)).toBe(true);
    spy.release();
    expect(callsAfter(spy.calls(), "closed")).toEqual([]);
    expect(commits()).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("kills the ask for the remote's default branch at a stop (row 018-28)", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    git(dev, ["remote", "set-head", "origin", "-d"]);
    const { reader, commits, notes } = readerOf(dev, { listTimeoutMs: 20_000 });
    const spy = spyGit(s, `"ls-remote --symref origin HEAD"`);
    reader.nudge();
    await spy.held();
    reader.close();
    spy.mark("closed");
    expect(await idleWithin(reader, 2_000)).toBe(true);
    spy.release();
    expect(callsAfter(spy.calls(), "closed")).toEqual([]);
    expect(commits()).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("starts no git to read an unborn HEAD", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    git(dev, ["checkout", "-q", "--orphan", "unborn"]);
    const { run, commits } = readerOf(dev);
    const spy = spyGit(s, null);
    await run();
    expect(spy.calls()).toEqual([]);
    expect(commits()).toEqual([]);
  });

  it("kills the HEAD read through git at a stop", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    reftableLike(dev);
    const { reader, commits } = readerOf(dev);
    const spy = spyGit(s, `"rev-parse --verify -q HEAD"`);
    reader.nudge();
    await spy.held();
    reader.close();
    spy.mark("closed");
    expect(await idleWithin(reader, 2_000)).toBe(true);
    spy.release();
    expect(callsAfter(spy.calls(), "closed")).toEqual([]);
    expect(commits()).toEqual([]);
  });

  it("bounds the HEAD read through git with its own timer", async () => {
    const s = scratch();
    const { dev } = await publishedClone(s);
    reftableLike(dev);
    const { reader, commits } = readerOf(dev, { headTimeoutMs: 200 });
    const spy = spyGit(s, `"rev-parse --verify -q HEAD"`);
    reader.nudge();
    await spy.held();
    expect(await idleWithin(reader, 2_000)).toBe(true);
    spy.release();
    expect(spy.calls()).toEqual(["rev-parse --verify -q HEAD"]);
    expect(commits()).toEqual([]);
  });
});

describe("the shared results reader's start point (018 D14, R1 B2)", () => {
  it("takes the new nearest main commit when main moved and HEAD did not", async () => {
    const s = scratch();
    const ci = cloneWith(s, "ci", 1);
    const [c0] = ci.commits as [string];
    git(ci.root, ["checkout", "-qb", "feature"]);
    git(ci.root, ["commit", "-q", "--allow-empty", "-m", "c1"]);
    const c1 = git(ci.root, ["rev-parse", "HEAD"]);
    git(ci.root, ["push", "-q", "origin", "feature"]);
    await publish(ci.root, c0);
    await publish(ci.root, c1);
    const dev = cloneOf(s, "dev");
    git(dev, ["checkout", "-qb", "feature", "origin/feature"]);
    const { run, commits, notes } = readerOf(dev);
    await run();
    expect(commits()).toEqual([c0]);

    // Main fast-forwards to c1; the clone fetches and stays on its branch.
    git(ci.root, ["push", "-q", "origin", "feature:main"]);
    git(dev, ["fetch", "-q", "origin"]);
    expect(git(dev, ["rev-parse", "HEAD"])).toBe(c1);
    expect(git(dev, ["merge-base", "HEAD", "origin/main"])).toBe(c1);
    await run();
    expect(commits().sort()).toEqual([c0, c1].sort());
    expect(notes).toEqual([]);
  });
});
