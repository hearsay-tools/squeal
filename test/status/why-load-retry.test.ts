import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { askRetry, recordRunLoad } from "../../src/core/retry/index.js";
import { formatWhy, readWhy } from "../../src/core/status/index.js";
import { NOW, seededFailure } from "../retry/load-retry-fixture.js";
import { reportOf } from "./why-seed.js";

/*
 * Row 011-67 (gh-52): `why` states a known failure's recorded facts as status
 * does, and one recorded at or above one load per CPU, with no retry asked,
 * names its load retry. Guidance only: nothing is asked or queued (011 C5).
 */

const NAME = "src/auth.test.ts > auth > login";
const seeded = (outcome: "fail" | "pass" = "fail") => seededFailure(outcome);

describe("squeal why: a known failure's recorded facts and its load retry (row 011-67)", () => {
  it("names the load retry, as the reader's command would, at or above one load per CPU", () => {
    const { repo, store } = seeded();
    recordRunLoad(store, "run-1", 1);
    const why = reportOf(readWhy(repo.main, NAME));

    expect(why.recorded).toMatchObject({ worktreeId: repo.mainId, revision: 4, loadPerCpu: 1 });
    expect(formatWhy(why, "/opt/squeal", { base: "src", now: NOW })).toContain(
      "\n  Recorded just now in this worktree at revision 4, load 1.00 per CPU when it ran; no retry asked at these inputs; `/opt/squeal retry auth.test.ts --reason load` runs it once more when the one-minute load average is below the CPU count\n",
    );
    expect(formatWhy(why, undefined, { now: NOW })).toContain(
      "`squeal retry src/auth.test.ts --reason load`",
    );
  });

  it("states the facts with no command below one load per CPU", () => {
    const { repo, store } = seeded();
    recordRunLoad(store, "run-1", 0.99);
    const text = formatWhy(reportOf(readWhy(repo.main, NAME)), "squeal", { now: NOW });

    expect(text).toContain(
      "\n  Recorded just now in this worktree at revision 4, load 0.99 per CPU when it ran; no retry asked at these inputs\n",
    );
    expect(text).not.toContain("--reason load");
  });

  it("names no command once a retry was asked, and asks none itself", () => {
    const { repo, store, testFile } = seeded();
    recordRunLoad(store, "run-1", 3.33);
    askRetry(store, {
      testFile,
      key: "k1",
      session: "s1",
      reason: "load",
      at: NOW,
      worktreeId: repo.mainId,
    });
    const why = reportOf(readWhy(repo.main, NAME));

    expect(why.recorded?.retry).toEqual({ reason: "load", outcome: "pending" });
    const text = formatWhy(why, "squeal", { now: NOW });
    expect(text).toContain(
      "load 3.33 per CPU when it ran; retry asked (load) at these inputs, pending\n",
    );
    expect(text).not.toContain("squeal retry");
  });

  it("names the CLI the shell runs and the path from its cwd at `squeal why`", () => {
    const { repo, store } = seeded();
    recordRunLoad(store, "run-1", 2);
    const cwd = join(repo.main, "src");
    mkdirSync(cwd);
    let stdout = "";
    const code = main(["why", NAME], {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
      cwd,
      now: () => NOW,
      env: { CODEX_SESSION_ID: "thread-1", PLUGIN_ROOT: "/opt/codex-plugin" },
    });

    expect(code).toBe(0);
    expect(stdout).toMatch(
      /load 2\.00 per CPU when it ran; no retry asked at these inputs; `node --disable-warning=ExperimentalWarning \S*\/opt\/codex-plugin\/dist\/cli\/squeal\.mjs\S* retry auth\.test\.ts --reason load` runs it/,
    );
  });

  it("gives no recorded facts for a passing check", () => {
    const { repo, store } = seeded("pass");
    recordRunLoad(store, "run-1", 3.33);
    const why = reportOf(readWhy(repo.main, NAME));

    expect(why.recorded).toBeUndefined();
    expect(formatWhy(why, "squeal", { now: NOW })).not.toContain("Recorded");
  });
});
