import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createNodeTestRunners } from "../../src/core/daemon/node-test-runners.js";
import { createPytestRunners } from "../../src/core/daemon/pytest-runners.js";
import { createRecoveringRunner } from "../../src/core/daemon/runner.js";
import { WorktreePaths } from "../../src/core/fs/worktree-paths.js";
import { type HostedAdapter, serveRunnerHost } from "../../src/core/runner-host/host.js";
import {
  encodeLine,
  frameOf,
  type HostRunner,
  type HostStarted,
  RUNNER_HOST_PROTOCOL,
} from "../../src/core/runner-host/protocol.js";
import { startHostProxy } from "../../src/core/runner-host/proxy.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { NodeTestProject, PytestProject } from "../../src/core/types/policy.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { nodeTestTraits } from "../../src/runners/node-test/traits.js";
import { pytestTraits } from "../../src/runners/pytest/traits.js";
import { VitestAdapter } from "../../src/runners/vitest/adapter.js";
import { vitestTraits } from "../../src/runners/vitest/traits.js";
import { fakeAdapter, inProcessHost, POLICY } from "../runner-host/fake-channel.js";
import { A, answers, DEFAULTS, VITEST_TABLE } from "./runner-traits-fixture.js";

/*
 * Row 011-329, the runner traits table: each runner kind by holder, read
 * through `traits` as the scheduler reads them. The in-process adapter, the
 * runner host's proxy over the values the host sent, and the recovering
 * runner before creation, after an idle close and after its host died
 * (spec 021 D7, D20.1). The host's start reply stays as it was sent.
 */

const dir = mkdtempSync(join(tmpdir(), "squeal-traits-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.useRealTimers();
});

const VITEST = { ...DEFAULTS, focuses: true };
const NODE_TEST = { ...DEFAULTS, tierWidth: 4, besideBacklog: true, backlogSlot: 1 };
const PYTEST = { ...NODE_TEST, backlogSlot: 5, focuses: true };
const NT: NodeTestProject = { name: "nt", cwd: "nt", node: "node", argv: [], env: {}, include: [] };
const py = (batchSize?: number): PytestProject => ({
  name: "py",
  cwd: "py",
  args: [],
  env: {},
  include: ["test_*.py"],
  ...(batchSize === undefined ? {} : { batchSize }),
});

let tierSize = 4;

describe("runner traits by holder: the in-process adapter", () => {
  it("is Vitest's over the widths its hints give and the last listing", () => {
    const hints = { started: () => {}, size: () => {}, table: () => VITEST_TABLE };
    const adapter = new VitestAdapter(
      new WorktreePaths(dir as AbsolutePath),
      undefined as never,
      undefined,
      undefined,
      undefined,
      hints,
    );
    expect(answers(adapter.traits)).toEqual({ ...VITEST, slowWidth: 2, tierWidth: 2 });
  });

  it("is node:test's at runner.tierSize, read per answer", async () => {
    const adapter = await createNodeTestAdapter(NT, {
      root: dir as AbsolutePath,
      concurrency: () => tierSize,
      note: () => {},
    });
    tierSize = 4;
    expect(answers(adapter.traits)).toEqual(NODE_TEST);
    tierSize = 6;
    expect(answers(adapter.traits)).toEqual({ ...NODE_TEST, tierWidth: 6 });
    tierSize = 4;
    await adapter.close();
  });
});

/** A proxy of `runner` over a host in this process serving `adapter`. */
async function proxyOf(runner: HostRunner, adapter: HostedAdapter, project?: PytestProject) {
  const host = inProcessHost(async () => adapter);
  const proxy = await startHostProxy({
    channel: host.channel,
    runner,
    version: "0.0.0-test",
    options: { childEnv: {}, ...(project === undefined ? {} : { process: { project } }) },
    policy: () => ({ ...POLICY, ...(runner === "vitest" ? {} : { tierSize }) }),
  });
  return { proxy, close: () => proxy.close().then(() => host.served) };
}

describe("runner traits by holder: the runner host's proxy over the values sent", () => {
  it("is Vitest's over the widths and count the host sent last", async () => {
    let omitted = 0;
    const { proxy, close } = await proxyOf(
      "vitest",
      fakeAdapter({
        traits: vitestTraits({ widths: () => VITEST_TABLE, omitted: () => omitted }),
        widthValues: () => VITEST_TABLE,
        testFiles: async () => {
          omitted = 3;
          return [A];
        },
      }),
    );
    expect(answers(proxy.traits)).toEqual({ ...VITEST, slowWidth: 2, tierWidth: 2 });
    await proxy.testFiles();
    expect(answers(proxy.traits)).toEqual({ ...VITEST, omitted: 3, slowWidth: 2, tierWidth: 2 });
    await close();
  });

  it.each([
    ["node:test", "node-test" as const, undefined, NODE_TEST],
    ["pytest with no batch size", "pytest" as const, py(), PYTEST],
    ["pytest with a batch size of 2", "pytest" as const, py(2), { ...PYTEST, backlogSlot: 2 }],
  ])("is %s's at the policy's runner.tierSize", async (_, runner, project, expected) => {
    const { proxy, close } = await proxyOf(runner, fakeAdapter(), project);
    expect(answers(proxy.traits)).toEqual(expected);
    tierSize = 6;
    expect(answers(proxy.traits)).toEqual({ ...expected, tierWidth: 6 });
    tierSize = 4;
    await close();
  });
});

describe("runner traits by holder: the recovering runner", () => {
  it.each([
    ["node:test", () => createNodeTestRunners([NT], options())[0], NODE_TEST],
    ["pytest with no batch size", () => createPytestRunners([py()], options())[0], PYTEST],
    [
      "pytest with a batch size of 2",
      () => createPytestRunners([py(2)], options())[0],
      { ...PYTEST, backlogSlot: 2 },
    ],
    ["Vitest", () => vitestRunner(async () => Promise.reject(new Error("no config"))), VITEST],
  ])("before creation is %s's over no values", (_, make, expected) => {
    const runner = make();
    if (runner === undefined) throw new Error("no runner");
    expect(answers(runner.traits)).toEqual(expected);
    tierSize = 6;
    expect(answers(runner.traits).tierWidth).toBe(expected === VITEST ? 8 : 6);
    tierSize = 4;
  });

  it("answers from the adapter closed when idle until another exists (spec 021 D20.1)", async () => {
    vi.useFakeTimers();
    const made: RunnerAdapter[] = [];
    const runner = vitestRunner(async () => instance(made), { idleMs: () => 1000 });
    expect(answers(runner.traits)).toEqual(VITEST);
    await runner.open();
    expect(answers(runner.traits)).toEqual({ ...VITEST, omitted: 1, slowWidth: 1, tierWidth: 1 });
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(closed).toContain(made[0]));
    expect(answers(runner.traits)).toEqual({ ...VITEST, omitted: 1, slowWidth: 1, tierWidth: 1 });
    await runner.closure(A);
    expect(answers(runner.traits)).toEqual({ ...VITEST, omitted: 2, slowWidth: 2, tierWidth: 2 });
    await runner.close();
  });

  it("answers its kind's over no values after its host died, until another starts (spec 021 D7)", async () => {
    const made: RunnerAdapter[] = [];
    const dead = new Set<RunnerAdapter>();
    let next: (() => void) | null = null;
    const runner = vitestRunner(
      async () => {
        if (made.length > 0) await new Promise<void>((resolve) => (next = resolve));
        return instance(made);
      },
      { gone: (adapter) => dead.has(adapter) },
    );
    await runner.open();
    const first = { ...VITEST, omitted: 1, slowWidth: 1, tierWidth: 1 };
    expect(answers(runner.traits)).toEqual(first);
    for (const adapter of made) dead.add(adapter);
    const call = runner.closure(A);
    await vi.waitFor(() => expect(next).not.toBeNull());
    expect(answers(runner.traits)).toEqual(VITEST);
    (next as (() => void) | null)?.();
    await call;
    expect(answers(runner.traits)).toEqual({ ...VITEST, omitted: 2, slowWidth: 2, tierWidth: 2 });
    await runner.close();
  });
});

/** The adapters closed, in order. */
const closed: RunnerAdapter[] = [];

/** Vitest's `n`th adapter of `made`: `n` files left out, at most `n` workers per project. */
function instance(made: RunnerAdapter[]): RunnerAdapter {
  const n = made.length + 1;
  const table = { projects: [{ project: "", ceiling: n, floor: 1, group: 0 }] };
  const adapter: RunnerAdapter = fakeAdapter({
    traits: vitestTraits({ widths: () => table, omitted: () => n }),
    close: async () => {
      closed.push(adapter);
    },
  });
  made.push(adapter);
  return adapter;
}

/** The recovering runner as the daemon builds Vitest's fast instance. */
function vitestRunner(
  create: () => Promise<RunnerAdapter>,
  extra: { idleMs?: () => number; gone?: (adapter: RunnerAdapter) => boolean } = {},
) {
  return createRecoveringRunner({
    name: "vitest",
    adapterVersion: "1",
    traits: vitestTraits(),
    create,
    onFailure: () => {},
    ...extra,
  });
}

function options() {
  return {
    root: dir as AbsolutePath,
    stateDir: dir as AbsolutePath,
    tempDir: dir as AbsolutePath,
    tierSize: () => tierSize,
    note: () => {},
  };
}

/** The `adapter` and `values` of the start reply a host serving `adapter` writes, as text. */
async function startReply(runner: HostRunner, adapter: HostedAdapter): Promise<string> {
  const input = new PassThrough();
  const lines: string[] = [];
  const served = serveRunnerHost({
    input,
    write: (line) => lines.push(line),
    build: async () => adapter,
    version: "0.0.0-test",
  });
  const start = { protocol: RUNNER_HOST_PROTOCOL, version: "0.0.0-test", runner };
  const options = { childEnv: {} };
  input.write(encodeLine({ id: 1, m: "start", a: [{ ...start, options, policy: POLICY }] }));
  await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
  input.end();
  await served;
  const reply = JSON.parse(frameOf(lines[0] ?? "") ?? "null") as { r: HostStarted };
  return JSON.stringify({ adapter: reply.r.adapter, values: reply.r.values });
}

describe("the runner host's start reply (spec 021 D6): as sent before row 011-329", () => {
  it.each([
    [
      "vitest" as const,
      fakeAdapter({
        traits: vitestTraits({ widths: () => VITEST_TABLE, omitted: () => 3 }),
        widthValues: () => VITEST_TABLE,
      }),
      '{"adapter":{"name":"vitest","adapterVersion":"fake-1","focuses":true,"members":[]},"values":{"omittedTestFiles":3,"widths":{"projects":[{"project":"","ceiling":2,"floor":1,"group":0}]}}}',
    ],
    [
      "node-test" as const,
      fakeAdapter({ name: "node-test", traits: nodeTestTraits({ tierSize: () => 4 }) }),
      '{"adapter":{"name":"node-test","adapterVersion":"fake-1","focuses":false,"members":[]},"values":{"omittedTestFiles":0,"widths":null}}',
    ],
    [
      "pytest" as const,
      fakeAdapter({ name: "pytest", traits: pytestTraits({ tierSize: () => 4 }) }),
      '{"adapter":{"name":"pytest","adapterVersion":"fake-1","focuses":true,"members":[]},"values":{"omittedTestFiles":0,"widths":null}}',
    ],
  ])("of %s", async (runner, adapter, sent) => {
    expect(await startReply(runner, adapter)).toBe(sent);
  });
});
