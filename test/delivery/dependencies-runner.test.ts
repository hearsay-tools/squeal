import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  Delta,
  HarnessDelivery,
  ResultRecord,
  SetupCheckId,
  StateSink,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Task 007-40, lessons defect 6: "No dependencies are installed" reads only
 * Node's installed lockfiles, so it is said beside a failure of a Node runner
 * (Vitest or node:test) only. A pytest check runs only in an admitted
 * environment (007 D2), so beside a pytest failure the sentence is false.
 * Spec 016 D3 (row 007-45): the runner is the one the store recorded with the
 * check's results, never one read from the policy or the file's name.
 */

const SENTENCE = "No dependencies are installed in this worktree";
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const NODE: TestFileRef = { project: "", path: "src/a.test.ts" };
const PY: TestFileRef = { project: "py", path: "tests/test_a.py" };
/** A text doctest (`--doctest-glob=*.txt`): a pytest check in a file that is not Python. */
const DOC: TestFileRef = { project: "py", path: "docs/example.txt" };
/** 007 `reviews/wave-5.875.md` B1: a doctest pytest collects from a JavaScript file (`--doctest-glob=*.js`). */
const JS_DOC: TestFileRef = { project: "py", path: "docs/example.js" };
const UNIT: TestFileRef = { project: "unit", path: "test/a.test.js" };
const NONE = { checkpointId: null };
/** The runner each project's results are stored with, as the scheduler records it. */
const RUNNERS: Readonly<Record<string, string>> = { "": "vitest", py: "pytest", unit: "node-test" };

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

/** A worktree whose policy configures one pytest project, `py`, beside any Vitest project. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-deps-"));
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({ pytest: [{ name: "py", include: ["tests/test_*.py"] }] }),
  );
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: "/repo/.git",
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1", { file: NODE });
  setKey(store, "k1", { file: PY });
  setKey(store, "k1", { file: DOC });
  setKey(store, "k1", { file: JS_DOC });
  setKey(store, "k1", { file: UNIT });
  liveDaemon(store, WT);
  // Hashed, and no installed Node lockfile among them: Node is not installed.
  store.fileHashes.upsertMany(
    WT,
    [NODE, PY, DOC, JS_DOC, UNIT]
      .map((f) => f.path)
      .concat("uv.lock")
      .map((path) => ({
        path,
        mtimeMs: 1,
        ctimeMs: 1,
        size: 1,
        inode: 1,
        hash: "h",
      })),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function revision(): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [],
  }).number;
}

/** Stores `results` with their project's runner, or with none as an older daemon did. */
function apply(...results: ResultRecord[]): void {
  applyBy((project) => RUNNERS[project], ...results);
}

function applyBy(runner: (project: string) => string | undefined, ...results: ResultRecord[]) {
  const at = revision();
  for (const r of results) store.results.putMany([r], runner(r.check.project));
  sink.applyResults(WT, at, results, NONE);
}

const node = check("a", NODE);
const py = check("test_a", PY);
const doc = check("example.txt", DOC);
const jsDoc = check("example.js", JS_DOC);
const unit = check("a", UNIT);

describe("a pytest failure", () => {
  it("is never told no dependencies are installed in a delivery", async () => {
    apply(result(py, "pass"));
    await delivery.register(C1, { atStart: true });
    apply(result(py, "fail"));
    const delta = (await delivery.onToolBoundary(C1)) as Delta;
    expect(delta.entries.some((e) => e.to === "fail")).toBe(true);
    expect(delta.header.dependenciesInstalled).toBeUndefined();
    expect(formatDelta(delta)).not.toContain(SENTENCE);
  });

  it("is never told it at start", async () => {
    apply(result(py, "fail"));
    const text = formatRegistration(await delivery.register(C1, { atStart: true }));
    expect(text).toContain("test_a");
    expect(text).not.toContain(SENTENCE);
  });
});

describe("a Vitest failure in a worktree with no Node install", () => {
  it("is told it in a delivery and at start, beside a pytest failure too", async () => {
    apply(result(node, "pass"), result(py, "pass"));
    await delivery.register(C1, { atStart: true });
    apply(result(node, "fail"), result(py, "fail"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).toContain(SENTENCE);
    const again = { ...C1, sessionId: "s2" };
    expect(formatRegistration(await delivery.register(again, { atStart: true }))).toContain(
      SENTENCE,
    );
  });

  it("is told it while the failure stands, not after only a pytest file fails", async () => {
    apply(result(node, "pass"), result(py, "pass"));
    await delivery.register(C1, { atStart: true });
    apply(result(py, "fail"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).not.toContain(SENTENCE);
    apply(result(node, "fail"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).toContain(SENTENCE);
  });
});

/*
 * Review wave-5.5 B1: an unreadable or deleted policy, which reads as no
 * pytest projects, does not turn a stored pytest failure into a Node one.
 * Review wave-5.75: nor does one that no longer declares the project, for a
 * Python test file or a text doctest alike. Review wave-5.875 B1: nor for a
 * doctest in a JavaScript file. The stored runner decides; the policy is not read.
 */
describe.each([
  ["Python test file", py],
  ["text doctest", doc],
  ["JavaScript doctest", jsDoc],
])("a pytest failure in a %s when the policy cannot name its project", (_, failing) => {
  it.each([
    ["malformed", () => writeFileSync(join(root, "squeal.config.json"), "{ not json")],
    ["missing", () => rmSync(join(root, "squeal.config.json"))],
    [
      "unreadable",
      () => {
        rmSync(join(root, "squeal.config.json"));
        mkdirSync(join(root, "squeal.config.json"));
      },
    ],
    ["no longer declaring it", () => writeFileSync(join(root, "squeal.config.json"), "{}")],
  ])("is never told it with a %s policy", async (_, breakPolicy) => {
    apply(result(failing, "pass"));
    await delivery.register(C1, { atStart: true });
    breakPolicy();
    apply(result(failing, "fail"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).not.toContain(SENTENCE);
    const again = { ...C1, sessionId: "s2" };
    expect(formatRegistration(await delivery.register(again, { atStart: true }))).not.toContain(
      SENTENCE,
    );
  });
});

describe.each([
  ["Vitest", node],
  ["node:test", unit],
])("a %s failure in a worktree with no Node install", (_, failing) => {
  it.each([
    ["no policy file", () => rmSync(join(root, "squeal.config.json"))],
    ["a malformed policy", () => writeFileSync(join(root, "squeal.config.json"), "{ not json")],
    ["a policy that declares it", () => {}],
  ])("is told it with %s, in a delivery and at start", async (_, setPolicy) => {
    setPolicy();
    apply(result(failing, "pass"));
    await delivery.register(C1, { atStart: true });
    apply(result(failing, "fail"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).toContain(SENTENCE);
    const again = { ...C1, sessionId: "s2" };
    expect(formatRegistration(await delivery.register(again, { atStart: true }))).toContain(
      SENTENCE,
    );
  });
});

describe("the runner decides, never the file's name", () => {
  it("a Node runner's failure in a file of another suffix is told it", async () => {
    const vue = check("renders", { project: "", path: "src/App.test.vue" });
    setKey(store, "k1", { file: { project: "", path: vue.testPath } });
    apply(result(vue, "fail"));
    const text = formatRegistration(await delivery.register(C1, { atStart: true }));
    expect(text).toContain("renders");
    expect(text).toContain(SENTENCE);
  });

  it("a failure an older daemon stored, with no runner, is never told it", async () => {
    applyBy(() => undefined, result(node, "pass"));
    await delivery.register(C1, { atStart: true });
    applyBy(() => undefined, result(node, "fail"));
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).not.toContain(SENTENCE);
    const again = { ...C1, sessionId: "s2" };
    const text = formatRegistration(await delivery.register(again, { atStart: true }));
    expect(text).toContain(node.fullName);
    expect(text).not.toContain(SENTENCE);
  });
});

describe("a Vitest setup failure in a worktree with no Node install", () => {
  /** A global setup that failed: a known state with no stored result (001-382). */
  const setup: SetupCheckId = { kind: "setup", project: "", testPath: "test/global-setup.ts" };
  const error = {
    name: "Error",
    message: "Cannot find package 'pg'",
    stack: null,
    location: null,
    diff: null,
  };

  it("is told it, from the runner this worktree recorded with the setup check", async () => {
    await delivery.register(C1, { atStart: true });
    store.checks.recordSetupRunner(WT, setup, "vitest");
    sink.setupOutcome(WT, revision(), { check: setup, commit: null, error });
    expect(formatDelta((await delivery.onToolBoundary(C1)) as Delta)).toContain(SENTENCE);
    const again = { ...C1, sessionId: "s2" };
    expect(formatRegistration(await delivery.register(again, { atStart: true }))).toContain(
      SENTENCE,
    );
  });
});
