import { describe, expect, it } from "vitest";
import type { SideState } from "../../src/cli/status-at-report.js";
import { fixture, git, linkInstall } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { atHead, clean, run } from "./status-at-kit.js";

/*
 * Review wave-13 third look (the human, 2026-11-19, "A: key per project"):
 * a `--run` batch's completion record names each file's project, so a path
 * two projects run keeps each project's own outcome after a stop, never
 * one for both. The reviewer's fixture: coverage off, two Vitest projects
 * running one test file with opposite outcomes, a held close, a stop. The
 * control without the hold reads the answer, whose projects must agree.
 * The accepted limit's wording is in `status-at-review13-maybe.test.ts`.
 */

const PROJECTS = (setup: boolean) =>
  [
    "export default { test: {",
    ...(setup ? ['  globalSetup: ["./hold.mjs"],'] : []),
    "  projects: [",
    '    { test: { name: "pass", include: ["test/*.test.ts"], setupFiles: ["./pass.mjs"] } },',
    '    { test: { name: "fail", include: ["test/*.test.ts"], setupFiles: ["./fail.mjs"] } },',
    "  ],",
    "} };",
    "",
  ].join("\n");

function twoProjects(held: boolean) {
  return fixture({
    "squeal.config.json": '{ "coverage": { "enabled": false } }\n',
    "vitest.config.mjs": PROJECTS(held),
    "hold.mjs":
      "export default function setup() {\n  return () => new Promise((done) => setTimeout(done, 600_000));\n}\n",
    "pass.mjs": 'globalThis.MODE = "good";\n',
    "fail.mjs": 'globalThis.MODE = "bad";\n',
    "test/a.test.ts":
      'import { expect, it } from "vitest";\nit("mode", () => expect((globalThis as { MODE?: string }).MODE).toBe("good"));\n',
  });
}

type Row = { project: string; path: string; at: SideState };
const rows = (out: string) =>
  new Map((JSON.parse(out).files as Row[]).map((x) => [x.project, x.at] as const));

describe("review wave-13 third look: each project's own outcome after a stop", SLOW, () => {
  it("reports the failing project's failure and the passing project's pass", async () => {
    const f = twoProjects(true);
    const head = git(f.root, "rev-parse", "HEAD").trim();
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, ...atHead(f) };
    const stopped = await run(
      f,
      { commit: head, json: true, run: { allMissing: true, timeoutSeconds: 20 } },
      options,
    );
    const at = rows(stopped.out);
    const notStored = "the gate keeps a result only with coverage on";
    expect(at.get("pass")).toMatchObject({
      state: "pass",
      origin: { kind: "run", stored: false, notStored },
    });
    expect(at.get("fail")).toMatchObject({
      state: "fail",
      failed: ["mode"],
      origin: { kind: "run", stored: false, notStored },
    });
    expect(JSON.parse(stopped.out).run).toMatchObject({
      selected: 2,
      ran: 2,
      stored: 0,
      notRun: 0,
      timedOut: true,
    });
    clean(f);
  });

  it("control, no hold: the answer's projects disagree, so neither is told", async () => {
    const f = twoProjects(false);
    const head = git(f.root, "rev-parse", "HEAD").trim();
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, ...atHead(f) };
    const answered = await run(
      f,
      { commit: head, json: true, run: { allMissing: true, timeoutSeconds: 60 } },
      options,
    );
    const reason = "its 2 projects ended differently, and no result was stored to tell them apart";
    for (const project of ["pass", "fail"])
      expect(rows(answered.out).get(project)).toEqual({ state: "not determined", reason });
    clean(f);
  });
});
