import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { main } from "../../src/cli/main.js";
import { REACH_DEPRECATED, reachCommand } from "../../src/cli/reach.js";
import { closureFor } from "../../src/core/delivery/closure.js";
import { ModuleSets } from "../../src/core/keys/modules.js";
import { ObservedSets } from "../../src/core/keys/observed.js";
import { readSnapshot } from "../../src/core/reach/read.js";
import type { ReachReport } from "../../src/core/reach/report-types.js";
import { writeImportGraph } from "../../src/core/store/import-edges.js";
import { readImportGraph } from "../../src/core/store/import-graph.js";
import { connectionOf } from "../../src/core/store/store.js";
import { A, B, closeStores, ON, run, SRC, seeded } from "./store-fixture.js";

/*
 * Row 015-128 (spec 015 D11 as amended 2026-11-22) against a real store:
 * a child process is read from `observedDirect.` only, a stale-key
 * worktree reads each test file's newest stored closure and walk with a
 * label while the strict readers stay strict, and `squeal reach` is a
 * hidden deprecated alias of `squeal impact`.
 */

afterEach(closeStores);

const ref = (path: string) => ({ project: "", path });

describe("child process", () => {
  it("reads observedDirect., never observedModules., which holds the worker's own loads", () => {
    const { repo, store } = seeded(ON);
    store.transaction(() => {
      const loads = new ModuleSets(store);
      loads.mark(ref(A), ["src/one.ts"]);
      loads.write();
      const observed = new ObservedSets(store);
      observed.mark(ref(B), ["src/two.ts"]);
      observed.write();
    });
    const { snapshot } = readSnapshot({ store, root: repo.main, code: null });
    const byPath = new Map(snapshot.testFiles.map((t) => [t.ref.path, t.childProcess]));
    expect(byPath.get(A)).toEqual(new Set());
    expect(byPath.get(B)).toEqual(new Set(["src/two.ts"]));
  });
});

const DAY = (n: number) => Date.UTC(2026, 10, n);

/** B's shared closure is the peer's, at the peer's key, and its only walk is at an older key. */
function staleB() {
  const seed = seeded(ON);
  const { repo, store } = seed;
  const peer = repo.addWorktree("peer").id;
  store.testFiles.put({
    testFile: ref(B),
    closure: {
      testFile: ref(B),
      paths: [B, ...SRC],
      complete: true,
      method: "static imports plus declared inputs",
    },
    updatedAt: DAY(4),
    updatedBy: peer,
  });
  const imports = [{ path: B, static: SRC }, ...SRC.map((path) => ({ path, static: [] }))].map(
    (f) => ({ ...f, sha1: createHash("sha1").update(f.path).digest("hex"), dynamic: [] }),
  );
  const conn = connectionOf(store);
  conn.transaction(() =>
    writeImportGraph(conn, {
      now: DAY(5),
      walks: [{ testFile: ref(B), key: "key-old", environment: "env-old", imports }],
      environments: [{ project: "", hash: "env-old", files: [], roots: [], imports: [] }],
    }),
  );
  return seed;
}

describe("stale-key fallback", () => {
  it("keeps closureFor and readImportGraph strict at the current key", () => {
    const { repo, store } = staleB();
    expect(closureFor(store, repo.mainId)(ref(B))).toBeUndefined();
    expect(readImportGraph(store, repo.mainId).walk(ref(B))).toBeUndefined();
  });

  it("reads the newest stored closure and walk in squeal impact, and counts both in JSON", async () => {
    const { repo } = staleB();
    const report = JSON.parse((await run(repo.main, ["--json"])).stdout) as ReachReport;
    expect(report.stale).toEqual({ closures: 1, walks: 1, oldestAt: DAY(4), newestAt: DAY(5) });
    expect(report.suite.withoutClosure).toBe(0);
    const two = report.files.find((e) => e.files.includes("src/two.ts"));
    // The stale walk splits B's imports: direct, not unsplit.
    expect(two?.kinds).toEqual({ direct: 1 });
  });

  it("names the fallback and the commands that refresh it in the text header", async () => {
    const { repo } = staleB();
    expect((await run(repo.main, [])).stdout).toContain(
      "Stale: this worktree has no closure or walk at its current inputs for some test files, so 1 test file the newest stored closure and 1 test file the newest stored import walk are read instead, stored from 2026-11-04 to 2026-11-05; squeal start or squeal warmup refreshes them.\n",
    );
  });

  it("reads null with every closure and walk at the current key", async () => {
    const { repo } = seeded(ON);
    const report = JSON.parse((await run(repo.main, ["--json"])).stdout) as ReachReport;
    expect(report.stale).toBeNull();
    expect((await run(repo.main, [])).stdout).not.toContain("Stale:");
  });
});

function io(cwd: string) {
  const out = { stdout: "", stderr: "" };
  const cli: CliIo = {
    stdout: (t) => {
      out.stdout += t;
    },
    stderr: (t) => {
      out.stderr += t;
    },
    cwd,
    env: {},
  };
  return { cli, out };
}

describe("squeal reach, the hidden deprecated alias", () => {
  it("answers as squeal impact, with a notice on stderr for text and none for --json", async () => {
    const { repo } = seeded(ON);
    const impact = await run(repo.main, []);
    const text = io(repo.main);
    expect(await reachCommand([], text.cli)).toBe(0);
    expect(text.out).toEqual({ stdout: impact.stdout, stderr: REACH_DEPRECATED });
    expect(REACH_DEPRECATED).toBe(
      "squeal reach is deprecated: use squeal impact, which gives the same answer.\n",
    );
    const json = io(repo.main);
    expect(await main(["reach", "--json"], json.cli)).toBe(0);
    expect(json.out.stderr).toBe("");
    expect(JSON.parse(json.out.stdout)).toMatchObject({ v: 2 });
  });

  it("is left out of --help, and its --help is squeal impact's", async () => {
    const help = io(".");
    main(["--help"], help.cli);
    expect(help.out.stdout).toContain("  squeal impact [<path>...] [--limit <n>] [--json]\n");
    expect(help.out.stdout).not.toContain("squeal reach");
    const own = io(".");
    await main(["reach", "--help"], own.cli);
    expect(own.out.stdout).toMatch(
      /^Usage:\n {2}squeal impact \[<path>\.\.\.\] \[--limit <n>\] \[--json\]\n/,
    );
  });
});
