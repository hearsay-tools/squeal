import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { observeRecorder, unobservedEnv } from "../../../src/runners/observe/index.js";
import { UNOBSERVED } from "../../../src/runners/process/recorders.js";
import { observe } from "./helpers.js";

/*
 * Task 001-431, spec 001 D11 Fidelity: a Squeal run that does not observe,
 * started by a test under another Squeal's recorder, runs its processes free of
 * that recorder. Taking it out of `NODE_OPTIONS` is not enough: its spawn hook
 * is still in the process that starts the run and puts it back at every spawn,
 * unless the child's settings are not its own.
 */

const recorder = observeRecorder(
  new URL("../../../src/runners/observe/runtime.ts", import.meta.url),
) as string;
const url = pathToFileURL(recorder).href;
const OUTER = JSON.stringify({ out: "/tmp/outer", root: "/w", skip: [] });

describe("unobservedEnv", () => {
  it("is {} without another Squeal's recorder or settings", () => {
    expect(unobservedEnv({ PATH: "/bin" })).toEqual({});
    expect(unobservedEnv({ NODE_OPTIONS: "--require ./setup.cjs" })).toEqual({});
  });

  it("takes the recorder out of NODE_OPTIONS, empty when it was all there was", () => {
    expect(unobservedEnv({ NODE_OPTIONS: `--import ${url}` })).toEqual({ NODE_OPTIONS: "" });
    expect(unobservedEnv({ NODE_OPTIONS: `--require "${recorder}" --import tsx` })).toEqual({
      NODE_OPTIONS: "--import tsx",
    });
  });

  it("replaces another Squeal's settings with settings no recorder records with", () => {
    expect(unobservedEnv({ NODE_OPTIONS: `--import ${url}`, SQUEAL_OBSERVE: OUTER })).toEqual({
      NODE_OPTIONS: "",
      SQUEAL_OBSERVE: UNOBSERVED,
    });
  });
});

describe("the recorder beside a run that does not observe (task 001-431)", {
  timeout: 60_000,
}, () => {
  it("leaves its children and Workers free of it, and records none of them", () => {
    const seen = observe({
      "main.mjs": [
        'import { execFileSync, fork } from "node:child_process";',
        'import { once } from "node:events";',
        'import { Worker } from "node:worker_threads";',
        `const env = { ...process.env, NODE_OPTIONS: "", SQUEAL_OBSERVE: ${JSON.stringify(UNOBSERVED)} };`,
        'const sync = execFileSync(process.execPath, ["child.mjs"], { env, encoding: "utf8" });',
        'const child = fork("child.mjs", { env, stdio: "pipe" });',
        "let async = '';",
        "child.stdout.on('data', (chunk) => (async += chunk));",
        "await once(child, 'exit');",
        'const worker = new Worker(new URL("./child.mjs", import.meta.url), { env, stdout: true });',
        "let thread = '';",
        "worker.stdout.on('data', (chunk) => (thread += chunk));",
        "await once(worker, 'exit');",
        "process.stdout.write(JSON.stringify([sync, async, thread]));",
      ].join("\n"),
      "child.mjs": [
        'import { readFileSync } from "node:fs";',
        'readFileSync(new URL("./data.txt", import.meta.url));',
        "process.stdout.write(JSON.stringify([process.env.NODE_OPTIONS, process.env.SQUEAL_OBSERVE]));",
      ].join("\n"),
      "data.txt": "d",
    });
    const free = JSON.stringify(["", UNOBSERVED]);
    expect(JSON.parse(seen.stdout)).toEqual([free, free, free]);
    expect(seen.paths).toContain("child.mjs");
    expect(seen.paths).not.toContain("data.txt");
  });
});
