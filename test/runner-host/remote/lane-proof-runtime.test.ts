import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeFiles } from "../../../src/core/keys/runtime-files.js";
import type { WhenLost } from "../../../src/core/runner-host/remote/settings.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunReport } from "../../../src/core/types/runner.js";
import { REPORT } from "../fake-channel.js";
import { background, REF, setup } from "./lane-fixture.js";

/*
 * Row 026-38 (#304; spec 026 D8, D12; 021 D10, D11; 011 C4/D4): a remote
 * run's proof drops exactly what the key drops, a declared runtime file and
 * a git-ignored path below a directory the same run wrote, and refuses at
 * once, with no resend, a path that exists only on the remote, naming it and
 * the two ways out. A file synced and then deleted here still repairs on the
 * resend; a real ignored input present here is still refused; a closure or
 * config path listed in `runtimeFiles` is still proven. Each under both
 * loss policies, over a real proxy and tree host in this process.
 */

const A = REF;
const B = { project: "", path: "test/b.test.ts" };
const TIER = [A, B];
const ENV_FILE = ".ai/qa/test-env.json";
const SHOT = ".ai/qa/artifacts/screen.png";
const BUILT = ".ai/qa/build/dist/activity.js";
const POLICIES: readonly WhenLost[] = ["not-run", "local"];

const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const paths = (report: RunReport) => report.completedFiles.map((f) => f.path).sort();
const resends = (logs: readonly string[]) => logs.filter((line) => /sending again/.test(line));

/** What each remote run does: it writes `make` there, and `a` observes `seen`, with `written`. */
interface Remote {
  readonly make?: Readonly<Record<string, string>>;
  readonly seen: readonly string[];
  readonly written?: readonly string[];
}

/**
 * A lane over a tree that ignores `.ai/qa/**`; `a` reads `seen` on the
 * remote each run, which writes `make` there first. `exists` is whether
 * `probe` existed there at each run's start.
 */
async function lane(
  whenLost: WhenLost,
  remote: Remote,
  extra: Partial<Parameters<typeof setup>[0]> & { probe?: string } = {},
) {
  const exists: boolean[] = [];
  const s = await setup({
    whenLost,
    files: {
      ".gitignore": ".ai/qa/**\n",
      "test/b.test.ts": "import '../src/a';\n",
      ...extra.files,
    },
    remoteRun: async (remoteRoot) => {
      const files = (s.remoteRuns.at(-1) ?? "").split(",").map((path) => ({ project: "", path }));
      if (extra.probe !== undefined) exists.push(existsSync(join(remoteRoot, extra.probe)));
      for (const [path, text] of Object.entries(remote.make ?? {})) put(remoteRoot, path, text);
      return {
        ...REPORT,
        completedFiles: files,
        observed: files.map((testFile) => ({
          testFile,
          paths: testFile.path === A.path ? [...remote.seen] : [],
          directories: [],
          ...(testFile.path === A.path && remote.written !== undefined
            ? { written: [...remote.written] }
            : {}),
        })),
      };
    },
    ...extra,
  });
  return { s, exists };
}

/** `WorktreeKeys.effectiveObserved`'s runtime step: `rules` applied, closure paths protected. */
function runtimeKeys(rules: readonly string[], root: () => string, closure: readonly string[]) {
  return (ref: TestFileRef, raw: readonly string[]) => {
    const runtime = new RuntimeFiles(
      [{ project: "", tests: [A.path], paths: [...rules] }],
      [],
      root(),
    );
    const applied = runtime.classify(ref, (path) =>
      closure.includes(path) ? "runner import, snapshot or unresolved candidate" : undefined,
    );
    return runtime.effective(raw, applied);
  };
}

describe.each(POLICIES)("a remote run's proof under whenLost %s (row 026-38)", (whenLost) => {
  it("keeps a result that read a runtime file the remote made, once declared in runtimeFiles", async () => {
    let root = "";
    const { s } = await lane(
      whenLost,
      { make: { [ENV_FILE]: "remote\n" }, seen: [ENV_FILE] },
      { effectiveObserved: runtimeKeys([ENV_FILE], () => root, []) },
    );
    root = s.root;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(s.localRuns).toHaveLength(0);
    expect(resends(s.logs)).toEqual([]);
    expect(report.failure).toBeNull();
    expect(paths(report)).toEqual([A.path, B.path]);
  });

  it("keeps a result that read a git-ignored screenshot below a directory the same run wrote", async () => {
    const { s } = await lane(whenLost, {
      make: { [SHOT]: "png\n" },
      seen: [SHOT],
      written: [".ai/qa/artifacts"],
    });
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(resends(s.logs)).toEqual([]);
    expect(report.failure).toBeNull();
    expect(paths(report)).toEqual([A.path, B.path]);
  });

  it("refuses at once, with one remote run, a file only the remote has, naming it and the fixes", async () => {
    const { s, exists } = await lane(
      whenLost,
      { make: { [BUILT]: "built there\n" }, seen: [BUILT] },
      { probe: BUILT },
    );
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toEqual([`${A.path},${B.path}`]);
    expect(exists).toEqual([false]);
    expect(resends(s.logs)).toEqual([]);
    const reason = `input ${BUILT} exists only on the remote, where no sync wrote it, so a resend cannot remove it; declare it in runtimeFiles when it is runtime state, or list its test files in remote.alwaysLocal`;
    expect(s.logs).toContain(`remote box: ${reason}; refused ${A.path}`);
    if (whenLost === "not-run") {
      // Its sibling keeps the remote's result; it alone stays not run.
      expect(s.localRuns).toHaveLength(0);
      expect(paths(report)).toEqual([B.path]);
      expect(report.failure).toBe(
        `remote box refused (${reason}); not run here (whenLost "not-run")`,
      );
      expect(s.statuses.at(-1)).toBe(
        "remote box: refused 1 files whose inputs exist only on the remote; not run",
      );
    } else {
      expect(s.localFiles).toEqual([A.path]);
      expect(paths(report)).toEqual([A.path, B.path]);
      expect(report.failure).toBeNull();
    }
  });

  it("refuses at once a remote-only file Git would not ignore, too", async () => {
    const { s } = await lane(whenLost, { make: { "made.json": "{}\n" }, seen: ["made.json"] });
    await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(resends(s.logs)).toEqual([]);
    expect(s.logs.some((line) => line.includes("input made.json exists only on the remote"))).toBe(
      true,
    );
  });

  it("repairs a file synced there and deleted here since: the resend removes it, then the run holds", async () => {
    const { s, exists } = await lane(
      whenLost,
      { seen: ["generated.json"] },
      { files: { "generated.json": "{}\n" }, probe: "generated.json" },
    );
    rmSync(join(s.root, "generated.json"));
    const report = await s.lane.run(TIER, background());
    expect(exists).toEqual([true, false]);
    expect(s.logs).toContain("remote box: tree differs at generated.json; sending again");
    expect(s.localRuns).toHaveLength(0);
    expect(report.failure).toBeNull();
    expect(paths(report)).toEqual([A.path, B.path]);
  });

  it("still refuses a real git-ignored input that exists here, at once", async () => {
    const { s } = await lane(
      whenLost,
      { make: { [ENV_FILE]: "remote\n" }, seen: [ENV_FILE] },
      { before: (root) => put(root, ENV_FILE, "local\n") },
    );
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(1);
    expect(resends(s.logs)).toEqual([]);
    const reason = `git-ignored input ${ENV_FILE} exists locally and is not synced to remote`;
    expect(s.logs).toContain(`remote box: ${reason}; refused ${A.path}`);
    if (whenLost === "not-run") expect(paths(report)).toEqual([B.path]);
    else expect(s.localFiles).toEqual([A.path]);
  });

  it("still proves a closure path and a config listed in runtimeFiles, which the key keeps", async () => {
    let root = "";
    let moves = 0;
    const { s } = await lane(
      whenLost,
      { seen: ["src/a.ts"] },
      {
        effectiveObserved: runtimeKeys(["src/a.ts", "vitest.config.ts"], () => root, ["src/a.ts"]),
        remoteRun: async (remoteRoot) => {
          // The run moves both on the remote, each time.
          put(remoteRoot, "src/a.ts", `moved ${++moves}\n`);
          put(remoteRoot, "vitest.config.ts", `moved ${moves}\n`);
          const files = (s.remoteRuns.at(-1) ?? "")
            .split(",")
            .map((path) => ({ project: "", path }));
          return {
            ...REPORT,
            completedFiles: files,
            observed: files.map((testFile) => ({
              testFile,
              paths: ["src/a.ts", "vitest.config.ts"],
              directories: [],
            })),
          };
        },
      },
    );
    root = s.root;
    const report = await s.lane.run(TIER, background());
    expect(s.remoteRuns).toHaveLength(2);
    expect(resends(s.logs)).toHaveLength(2);
    expect(s.logs).toContain(
      "remote box: tree differs at vitest.config.ts, src/a.ts; sending again",
    );
    if (whenLost === "not-run") {
      expect(report.completedFiles).toEqual([]);
      expect(report.failure).toMatch(/its tree stayed different at vitest\.config\.ts, src\/a\.ts/);
    } else expect(s.localFiles).toEqual([`${A.path},${B.path}`]);
  });
});
