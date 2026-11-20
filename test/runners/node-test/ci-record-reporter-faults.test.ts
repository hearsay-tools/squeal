import { describe, expect, it } from "vitest";
import { project, record, reporterPair } from "./ci-record-kit.js";

/*
 * Review of 0.1.579 B3 (spec 018 D20.2, D28): a failure of Squeal's
 * node:test reporter, injected after `ci record` started, never fails the
 * project's command. A passing run exits 0 and a failing one 1, as without
 * recording; the part of that process holds no file, so nothing it wrote
 * can export a pass, and `ci record` says why.
 */

const SLOW = { timeout: 120_000 } as const;
const PASSING = 'import { test } from "node:test";\ntest("passes", () => {});\n';
const FAILING =
  'import { test } from "node:test";\ntest("fails", () => { throw new Error("x"); });\n';

/** Removes the reporter's private events directory before the tests run (open fails). */
const REMOVE_EVENTS = [
  'const fs = require("node:fs");',
  'const settings = JSON.parse(process.env.SQUEAL_CI_RECORD || "{}");',
  "if (settings.nodeTest) fs.rmSync(settings.nodeTest.events, { recursive: true });",
].join("\n");

/**
 * A preload of the `node --test` process: every write after the first to a
 * file in the reporter's events directory fails (the header lands, the events do not).
 */
const FAIL_WRITES = [
  'const fs = require("node:fs");',
  'const settings = JSON.parse(process.env.SQUEAL_CI_RECORD || "{}");',
  "const events = settings.nodeTest && settings.nodeTest.events;",
  "const watched = new Map();",
  "const open = fs.openSync;",
  "fs.openSync = function (path, ...rest) {",
  "  const fd = open.call(this, path, ...rest);",
  "  if (events && String(path).startsWith(events)) watched.set(fd, 0);",
  "  return fd;",
  "};",
  "const write = fs.writeSync;",
  "fs.writeSync = function (fd, ...rest) {",
  "  if (watched.has(fd)) {",
  "    const count = watched.get(fd) + 1;",
  "    watched.set(fd, count);",
  '    if (count > 1) throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });',
  "  }",
  "  return write.call(this, fd, ...rest);",
  "};",
  'require("node:module").syncBuiltinESMExports();',
].join("\n");

function files(test: string) {
  return {
    "squeal.config.json": '{"nodeTest":[{"name":"u","include":["*.test.mjs"]}]}\n',
    "a.test.mjs": test,
    "remove-events.cjs": REMOVE_EVENTS,
    "fail-writes.cjs": FAIL_WRITES,
  };
}

const quote = (args: readonly string[]) => args.map((a) => `'${a}'`).join(" ");

describe("a failure of Squeal's node:test reporter (review of 0.1.579 B3)", () => {
  it.each([
    [PASSING, 0],
    [FAILING, 1],
  ])("on open keeps the command's exit code %#", SLOW, async (test, code) => {
    const root = project(files(test));
    const nodeTest = quote([process.execPath, "--test", ...reporterPair(), "a.test.mjs"]);
    const command = `'${process.execPath}' remove-events.cjs && ${nodeTest}`;
    const recorded = await record(root, ["sh", "-c", command]);
    expect(recorded.code, recorded.stderr).toBe(code);
    expect(recorded.stderr).toContain("could not record");
    expect(recorded.stderr).not.toContain("names no Squeal reporter");
    expect(recorded.parts.flatMap((p) => p.testFiles)).toEqual([]);
    expect(recorded.parts.every((p) => p.header.end !== "completed")).toBe(true);
  });

  it.each([
    [PASSING, 0],
    [FAILING, 1],
  ])("on write keeps the command's exit code %#", SLOW, async (test, code) => {
    const root = project(files(test));
    const command = [
      process.execPath,
      "--require",
      "./fail-writes.cjs",
      "--test",
      ...reporterPair(),
      "a.test.mjs",
    ];
    const recorded = await record(root, command);
    expect(recorded.code, recorded.stderr).toBe(code);
    expect(recorded.stderr).toContain("ENOSPC");
    expect(recorded.parts).toHaveLength(1);
    expect(recorded.parts[0]?.testFiles).toEqual([]);
    expect(recorded.parts[0]?.header.end).toBe("crashed");
  });
});
