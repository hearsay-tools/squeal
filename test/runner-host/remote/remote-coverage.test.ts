import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import {
  COVERAGE_RECORD_VERSION,
  decodeRecord,
  hasLine,
} from "../../../src/core/code/coverage/record.js";
import type { V8Payload } from "../../../src/core/code/coverage/types.js";
import { createCoverageWriter } from "../../../src/core/code/coverage/writer.js";
import { blobHash } from "../../../src/core/hash/blob.js";
import type { HostStart } from "../../../src/core/runner-host/protocol.js";
import {
  type RemoteHostOptions,
  remoteAdapterOptions,
  remoteHostOver,
} from "../../../src/core/runner-host/remote/connect.js";
import { sharedOf } from "../../../src/core/runner-host/remote/coverage.js";
import {
  createDaemonRemote,
  type DaemonRemote,
} from "../../../src/core/runner-host/remote/daemon-lane.js";
import type { RemoteLaneRunner } from "../../../src/core/runner-host/remote/lane.js";
import { remoteSettingsPath } from "../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import { HOST_PROVIDER } from "../../../src/core/runner-host/remote/tree-wire.js";
import { vitestCoverage } from "../../../src/core/runner-host/runners.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../../src/core/types/policy.js";
import type { RunOptions, RunReport } from "../../../src/core/types/runner.js";
import { commonDir, ON, open } from "../../code/helpers.js";
import { inProcessHost, POLICY, REPORT } from "../fake-channel.js";
import { until } from "./lane-fixture.js";
import { fake, VERSION } from "./share-fixture.js";

/*
 * Spec 026 D9 (row 026-13): coverage of a remote run, mapped where it ran.
 * The daemon's lane over a `command` machine; its host served here over a
 * real tree host, whose adapter writes a real V8 payload per file into the
 * remote tree's `tmp/coverage` and hands it over as an adapter does. The
 * host maps it with the daemon's mapping, deletes the payload, and the
 * reply's records reach a real records' writer and `code.sqlite` only once
 * the run is proven, and only for the files whose results stand.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-coverage-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SOURCE = "export function plain(x) {\n  return x + 1;\n}\n";
const A: TestFileRef = { project: "", path: "test/a.test.ts" };
const B: TestFileRef = { project: "", path: "test/b.test.ts" };
const GIT_FAIL =
  "Command failed: git rev-parse HEAD\nfatal: not a git repository (or any of the parent directories): .git";

let n = 0;
const edit = (): RunOptions => ({
  runId: `r${++n}`,
  logDir: join(scratch, `logs${n}`),
  timeoutMs: 60_000,
  lane: "vitest",
});

interface Behaviour {
  /** Changes the file here during each remote run: its proof never holds. */
  readonly tamper?: boolean;
  /** Ends the host during the run: it is lost. */
  readonly lose?: boolean;
  /** Fails `B` there as not a Git repository: D19.2's guard sends it here. */
  readonly gitFails?: boolean;
}

function remoteCoverage(entry: Record<string, unknown>, behaviour: Behaviour = {}) {
  const dir = join(scratch, `c${++n}`);
  const root = join(dir, "repo");
  const remoteTree = join(dir, "remote");
  for (const sub of ["src", "test"]) mkdirSync(join(root, sub), { recursive: true });
  mkdirSync(join(remoteTree, "root"), { recursive: true });
  mkdirSync(join(dir, "xdg", "squeal"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), SOURCE);
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  writeFileSync(join(root, "test/b.test.ts"), "import '../src/a';\n");
  execFileSync("git", ["init", "-q", root]);
  const real = realpathSync(root);
  const tree = realpathSync(remoteTree);
  const remoteRoot = join(tree, "root");
  const env = {
    XDG_CONFIG_HOME: join(dir, "xdg"),
    XDG_STATE_HOME: join(dir, "state"),
    HOME: join(dir, "home"),
    PATH: process.env.PATH,
  };
  const acquire = join(dir, "acquire.mjs");
  writeFileSync(
    acquire,
    `console.log(${JSON.stringify(JSON.stringify({ v: 1, id: "lan", destination: "dev@lan-box" }))});`,
  );
  writeFileSync(
    remoteSettingsPath(env),
    JSON.stringify({
      repositories: {
        [real]: {
          provider: "command",
          providerConfig: { acquire: [process.execPath, acquire] },
          lanes: ["edit", "background"],
          diskCheck: { enabled: false },
          ...entry,
        },
      },
    }),
  );

  const store = commonDir();
  const logs: string[] = [];
  const writer = createCoverageWriter({
    commonDir: store,
    format: "sha1",
    policy: () => ON,
    // The scheduler stored each result under its own key at once.
    resultKey: (_runId, testFile) => `key:${testFile.path}`,
    log: (line) => logs.push(line),
    worker: null,
    waitsMs: [0],
  });
  onTestFinished(() => writer.close());

  const starts: HostStart[] = [];
  const hosts: RemoteHostOptions[] = [];
  const payloads: string[] = [];
  const startHost = async (options: RemoteHostOptions) => {
    hosts.push(options);
    let served: ReturnType<typeof inProcessHost> | null = null;
    served = inProcessHost(
      async (start, hooks) => {
        starts.push(start);
        return fake("vitest", async (files, run) => {
          const out: RunReport = { ...REPORT, completedFiles: [...files] };
          // A new text at each attempt: the run there never ran over the file here.
          if (behaviour.tamper) writeFileSync(join(real, "src/a.ts"), `${SOURCE}// ${++n}\n`);
          if (behaviour.lose) {
            served?.channel.kill();
            return out;
          }
          if (!hooks.policy().coverage) return out;
          const coverageDir = join(tree, "tmp", "coverage");
          mkdirSync(coverageDir, { recursive: true });
          const url = pathToFileURL(join(remoteRoot, "src/a.ts")).href;
          const covered = files.map((testFile, i) => {
            const payload = join(coverageDir, `${run.runId}-${i}.json`);
            const v8: V8Payload = {
              result: [
                {
                  url,
                  functions: [
                    {
                      functionName: "",
                      ranges: [range(0, SOURCE.length, 1)],
                      isBlockCoverage: true,
                    },
                    {
                      functionName: "plain",
                      ranges: [range(0, SOURCE.length - 1, 1)],
                      isBlockCoverage: true,
                    },
                  ],
                },
              ],
            };
            writeFileSync(payload, JSON.stringify(v8));
            payloads.push(payload);
            return { testFile, payload, sources: new Map(), ownRoot: remoteRoot };
          });
          hooks.coverage({ runId: run.runId, files: covered });
          if (!behaviour.gitFails) return out;
          const failed = {
            testFile: B,
            errors: [{ message: GIT_FAIL }],
          } as unknown as RunReport["fileErrors"][number];
          return { ...out, fileErrors: [failed] };
        });
      },
      VERSION,
      { tree: createTreeHost(remoteRoot, () => {}) },
    );
    onTestFinished(() => served?.channel.kill());
    return remoteHostOver(served.channel, "v-test", {
      ...options,
      // As `startRemoteHost` makes them, over the remote tree's absolute path.
      options: remoteAdapterOptions(options.options, tree, options.coverage),
    });
  };

  const policy: Policy = DEFAULT_POLICY;
  const notes: [string, string][] = [];
  const remote = createDaemonRemote({
    root: real,
    commonDir: join(real, ".git"),
    version: VERSION,
    launch: { execPath: process.execPath, execArgv: [], cli: join(dir, "squeal.mjs") },
    policy: () => policy,
    note: (text, topic) => notes.push([topic, text]),
    lastNote: (topic) => notes.findLast(([t]) => t === topic)?.[1],
    log: (line) => logs.push(line),
    env,
    startHost,
    remoteCoverage: (runId, testFile, record) => writer.recordMapped(runId, testFile, record),
  }) as DaemonRemote;
  const localRuns: string[] = [];
  const here = fake("vitest", async (files) => {
    localRuns.push(files.map((f) => f.path).join(","));
    return { ...REPORT, completedFiles: [...files] };
  });
  const testFiles = here.testFiles;
  here.testFiles = async () => [...(await testFiles()), B];
  const lane = remote.wrap({
    runner: "vitest",
    local: here,
    tiers: ["edit", "background"],
    start: {
      // The daemon's own provider and temp directory: of this machine, not the remote's.
      options: {
        childEnv: {},
        coverage: { provider: "/laptop/provider.mjs", tempDir: "/laptop/tmp" },
      },
      policy: () => ({ ...POLICY, coverage: true }),
    },
  }) as unknown as RemoteLaneRunner;
  onTestFinished(async () => {
    await lane.close();
    await remote.release();
  });
  const record = (file: TestFileRef) => {
    const bytes = open(store).coverage.get({
      resultKey: `key:${file.path}`,
      providerVersion: COVERAGE_RECORD_VERSION,
    });
    return bytes === null ? null : decodeRecord(bytes);
  };
  return {
    lane,
    writer,
    starts,
    hosts,
    payloads,
    logs,
    localRuns,
    record,
    lastNote: () => notes.findLast(([t]) => t === "remote-lane")?.[1] ?? "",
  };
}

function range(startOffset: number, endOffset: number, count: number) {
  return { startOffset, endOffset, count };
}

describe("remote coverage, mapped where it ran (row 026-13, spec 026 D9)", () => {
  it("maps each file's payload there into a repository-relative record, deletes it, and stores it after the proof", async () => {
    const c = remoteCoverage({ coverage: "remote" });
    await until(() => / go there/.test(c.lastNote()));
    await c.lane.run([A], edit());
    await c.writer.idle();
    // The host loads its own provider, under the remote tree; the run asks for sha1 records.
    expect(c.hosts[0]?.coverage).toBe("remote");
    expect(c.hosts[0]?.coverageFormat).toBe("sha1");
    const coverage = c.starts[0]?.options.coverage;
    expect(coverage?.provider).toBe(HOST_PROVIDER);
    expect(coverage?.tempDir).toMatch(/\/remote\/tmp\/coverage$/);
    expect(c.starts[0]?.policy.coverage).toBe(true);
    // Mapped there and gone there.
    expect(c.payloads).toHaveLength(1);
    for (const payload of c.payloads) expect(existsSync(payload)).toBe(false);
    const stored = c.record(A);
    expect(stored?.unread).toEqual([]);
    expect(stored?.sources).toHaveLength(1);
    const source = stored?.sources[0];
    expect(source?.path).toBe("src/a.ts");
    expect(source?.blob).toBe(blobHash(Buffer.from(SOURCE), "sha1"));
    expect([1, 2, 3].filter((line) => hasLine(source?.lines ?? "", line - 1))).toEqual([1, 2]);
    expect(c.localRuns).toEqual([]);
  });

  it("stores no record of a run whose proof never holds: it runs here instead", async () => {
    const c = remoteCoverage({ coverage: "remote" }, { tamper: true });
    await until(() => / go there/.test(c.lastNote()));
    await c.lane.run([A], edit());
    await c.writer.idle();
    expect(c.localRuns).toEqual([A.path]);
    expect(c.payloads.length).toBeGreaterThan(0);
    for (const payload of c.payloads) expect(existsSync(payload)).toBe(false);
    expect(c.record(A)).toBeNull();
  });

  it("stores no record of a lost run", async () => {
    const c = remoteCoverage({ coverage: "remote", whenLost: "not-run" }, { lose: true });
    await until(() => / go there/.test(c.lastNote()));
    const report = await c.lane.run([A], edit());
    await c.writer.idle();
    expect(report.end).toBe("crashed");
    expect(c.record(A)).toBeNull();
  });

  it("stores no record of a file D19.2's guard sends here, and keeps the others'", async () => {
    const c = remoteCoverage({ coverage: "remote" }, { gitFails: true });
    await until(() => / go there/.test(c.lastNote()));
    await c.lane.run([A, B], edit());
    await c.writer.idle();
    expect(c.localRuns).toEqual([B.path]);
    expect(c.record(A)?.sources[0]?.path).toBe("src/a.ts");
    expect(c.record(B)).toBeNull();
  });

  it("strips coverage under coverage off, as 021 D12 does: nothing is asked for or stored", async () => {
    const c = remoteCoverage({ coverage: "off" });
    await until(() => / go there/.test(c.lastNote()));
    await c.lane.run([A], edit());
    await c.writer.idle();
    expect(c.hosts[0]?.coverageFormat).toBeUndefined();
    expect(c.starts[0]?.options.coverage).toBeUndefined();
    expect(c.starts[0]?.policy.coverage).toBe(false);
    expect(c.payloads).toEqual([]);
    expect(c.record(A)).toBeNull();
  });
});

describe("the provider a remote host's Vitest loads (row 026-13, spec 026 D9)", () => {
  const start = (provider: string): HostStart =>
    ({
      options: { childEnv: {}, coverage: { provider, tempDir: "/srv/tree/tmp/coverage" } },
    }) as never;
  const hooks = (notes: string[]) => ({ note: (text: string) => notes.push(text) }) as never;

  it("is the one beside the host's own code under HOST_PROVIDER, and the given one otherwise", () => {
    const notes: string[] = [];
    const own = vitestCoverage(start(HOST_PROVIDER), hooks(notes));
    expect(own?.provider).toMatch(/^\/.*\/coverage\/provider\.mjs$/);
    expect(existsSync(own?.provider ?? "")).toBe(true);
    expect(own?.tempDir).toBe("/srv/tree/tmp/coverage");
    expect(vitestCoverage(start("/srv/local/provider.mjs"), hooks(notes))?.provider).toBe(
      "/srv/local/provider.mjs",
    );
    expect(notes).toEqual([]);
  });
});

describe("a remote record as the daemon reads it (row 026-13, spec 026 D9)", () => {
  const wire = (record: unknown) => ({
    testFile: A,
    // As `encodeRecord` makes them: deflated JSON.
    record: deflateRawSync(JSON.stringify(record)).toString("base64"),
  });

  it("drops one that does not decode or names a path outside the root", () => {
    expect(sharedOf({ testFile: A, record: "not base64 deflate" })).toMatch(/does not decode/);
    const outside = { v: 1, sources: [{ path: "/srv/x.ts" }], unread: [] };
    expect(sharedOf(wire(outside))).toMatch(/outside the root: "\/srv\/x.ts"/);
    expect(sharedOf(wire({ v: 1, sources: [], unread: ["../up.ts"] }))).toMatch(/outside the root/);
    expect(sharedOf(wire({ v: 2 }))).toBe("its remote record is not a coverage record");
    const kept = sharedOf(wire({ v: 1, sources: [], unread: ["src/a.ts"] }));
    expect(typeof kept).toBe("object");
  });

  // Review 0.1.620 S2: every source and `unread` entry checked, and nothing thrown.
  const SOURCE_PART = { path: "src/a.ts", blob: "a", lines: "", covered: "", functions: [] };
  const withSource = (source: unknown, unread: unknown[] = []) =>
    sharedOf(wire({ v: 1, sources: [source], unread }));

  it("keeps a well-formed source", () => {
    const kept = withSource(SOURCE_PART, ["src/b.ts"]);
    expect(typeof kept).toBe("object");
    expect(kept).toMatchObject({ paths: ["src/a.ts", "src/b.ts"] });
  });

  it("drops a source with no path, a null source and a path that is not a string", () => {
    const { path: _, ...pathless } = SOURCE_PART;
    expect(withSource(pathless)).toBe("its remote record names a path outside the root: undefined");
    expect(withSource(null)).toBe("its remote record has a source that is not an object: null");
    expect(withSource(["src/a.ts"])).toMatch(/a source that is not an object/);
    expect(withSource({ ...SOURCE_PART, path: 7 })).toBe(
      "its remote record names a path outside the root: 7",
    );
  });

  it("drops a source whose fields are not a coverage source's", () => {
    expect(withSource({ ...SOURCE_PART, blob: 1 })).toMatch(/malformed source: "src\/a.ts"/);
    expect(withSource({ ...SOURCE_PART, functions: [[1, 2, 3]] })).toMatch(/malformed source/);
    expect(withSource({ ...SOURCE_PART, functions: null })).toMatch(/malformed source/);
  });

  it("drops an unread entry that is not a path inside the root", () => {
    expect(withSource(SOURCE_PART, [null])).toMatch(/outside the root: null/);
    expect(withSource(SOURCE_PART, [3])).toMatch(/outside the root: 3/);
    for (const path of ["", "/srv/x.ts", "src/../../x.ts", ".git/config", "src//a.ts"]) {
      expect(withSource(SOURCE_PART, [path])).toMatch(/outside the root/);
      expect(withSource({ ...SOURCE_PART, path })).toMatch(/outside the root/);
    }
  });

  it("drops a record that is no object, and wire bytes that are no string, without throwing", () => {
    expect(sharedOf(wire(null))).toBe("its remote record is not a coverage record");
    expect(sharedOf(wire({ v: 1, sources: {}, unread: [] }))).toMatch(/not a coverage record/);
    expect(sharedOf({ testFile: A, record: 42 as never })).toMatch(/does not decode/);
  });
});
