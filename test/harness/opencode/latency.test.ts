import { loadavg } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeTurn } from "../../../src/core/delivery/turn.js";
import { type Consumer, MAIN_AGENT } from "../../../src/core/types/index.js";
import type { CodexHookName } from "../../../src/harness/codex/index.js";
import { type BridgeCommand, callBridge } from "../../../src/harness/opencode/bridge-client.js";
import {
  bridgeFile,
  type OcConsumer,
  type OcKind,
  type OcRequest,
} from "../../../src/harness/opencode/protocol.js";
import { check, result } from "../../state/helpers.js";
import { liveSocket, quietCli, runBundle, runtimeDir } from "../bundle-helpers.js";
import { buildCodexBundles, codexInput, codexRecorded, sessionOf } from "../codex/helpers.js";
import { type SquealRepo, squealRepo } from "../helpers.js";
import { buildOpencodeBundles } from "./helpers.js";

/*
 * Spec 008 D4 and open question 3: each built bridge entry, run through the
 * plugin's bridge client as a hook runs it, beside the Codex hook it stands
 * for, in one run on one store of 50 test files of 10 checks: their samples
 * interleave, so load moves both alike, and both run in this process's
 * environment, the bridge by inheriting it as it inherits OpenCode's: a
 * variable such as `NODE_USE_ENV_PROXY` costs every Node start tens of ms,
 * and 002's test gives its hooks a bare one. A pair passes when the bridge's p95
 * is within `MARGIN_MS` of the Codex hook's in one of up to 3 rounds of 20
 * cold runs each; above load average 4, and in CI, one round of
 * `LOADED_RUNS` is reported and nothing is asserted, as 002's latency test
 * does.
 */

const RUNS = 20;
const ROUNDS = 3;
const MARGIN_MS = 10;
const MAX_LOAD = 4;
const FILES = 50;
const CHECKS_PER_FILE = 10;
const LOADED_RUNS = 5;
/** Half the test's timeout. */
const REPORT_BY_MS = 200_000;

const calm = () => (loadavg()[0] ?? 0) <= MAX_LOAD && process.env.CI === undefined;

/** The Codex fixtures' session, moved into the exec session (D2), and their subagent. */
const CODEX_SESSION = String(codexInput("exec", "session-start", "/").session_id);
const IN_SESSION = sessionOf("exec", "session-start");
const AGENT = String(codexInput("exec", "subagent-start", "/").agent_id);
/** The OpenCode consumers: a root session and its child (D2). */
const OC_ROOT = "ses_ec4f634c2ffeXYZG21QrpEdkY4";
const OC_CHILD = "ses_ec4f61774ffeIWyJMttM94R8E9";

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

/** A store the size of a small project: every check passing. */
function seeded(): SquealRepo {
  const r = squealRepo();
  const results = [];
  for (let f = 0; f < FILES; f++) {
    const file = { project: "", path: `src/m${f}.test.ts` };
    r.store.testFileKeys.upsertMany([
      { worktreeId: r.worktreeId, testFile: file, key: `k${f}`, revision: 1, pending: null },
    ]);
    for (let c = 0; c < CHECKS_PER_FILE; c++) {
      results.push(
        result(check(`m${f} > case ${c}`, file), "pass", {
          key: `k${f}`,
          worktreeId: r.worktreeId,
        }),
      );
    }
  }
  r.apply(r.pass(), ...results);
  return r;
}

const consumer = (r: SquealRepo, sessionId: string, agentId: string = MAIN_AGENT): Consumer => ({
  worktreeId: r.worktreeId,
  sessionId,
  agentId,
});
const flip = (r: SquealRepo, run: number) => r.apply(run % 2 === 0 ? r.fail() : r.pass());
/** Both sides' consumer left idle: a tool call's costliest silent path puts it back in a turn. */
const idleBoth = (r: SquealRepo) =>
  r.store.transaction(() => {
    writeTurn(r.store, consumer(r, CODEX_SESSION), null);
    writeTurn(r.store, consumer(r, OC_ROOT), null);
  });
const registerBoth = (r: SquealRepo) => {
  r.store.consumers.register(consumer(r, CODEX_SESSION, AGENT), Date.now());
  r.store.consumers.register(consumer(r, OC_ROOT, OC_CHILD), Date.now());
};

interface Pair {
  /** Row label; one ending "(silent)" must say nothing on either side. */
  readonly name: string;
  readonly codex: {
    readonly hook: CodexHookName;
    readonly fixture: string;
    readonly mode?: "app-server";
  };
  readonly opencode: { readonly kind: OcKind; readonly request: object };
  readonly before?: (r: SquealRepo, run: number) => void;
}

const ROOT: OcConsumer = { sessionId: OC_ROOT };
const CHILD: OcConsumer = { sessionId: OC_ROOT, agentId: OC_CHILD };

const PAIRS: readonly Pair[] = [
  {
    name: "register | session-start",
    codex: { hook: "session-start", fixture: "session-start" },
    opencode: { kind: "register", request: { consumer: ROOT } },
  },
  {
    name: "prompt | user-prompt-submit",
    codex: { hook: "user-prompt-submit", fixture: "user-prompt-submit" },
    opencode: { kind: "prompt", request: { consumer: ROOT } },
    before: flip,
  },
  {
    name: "before edit | pre-tool-use apply_patch",
    codex: { hook: "pre-tool-use", fixture: "pre-tool-use-apply-patch" },
    opencode: { kind: "before", request: { consumer: ROOT, tool: "edit" } },
    before: flip,
  },
  {
    name: "before bash | pre-tool-use Bash (silent)",
    codex: { hook: "pre-tool-use", fixture: "pre-tool-use" },
    opencode: { kind: "before", request: { consumer: ROOT, tool: "bash", command: "ls" } },
    before: idleBoth,
  },
  {
    name: "after | post-tool-use",
    codex: { hook: "post-tool-use", fixture: "post-tool-use" },
    opencode: { kind: "after", request: { consumer: ROOT, tool: "bash" } },
    before: flip,
  },
  {
    name: "after | post-tool-use (silent)",
    codex: { hook: "post-tool-use", fixture: "post-tool-use" },
    opencode: { kind: "after", request: { consumer: ROOT, tool: "bash" } },
  },
  {
    name: "stop | stop",
    codex: { hook: "stop", fixture: "stop" },
    opencode: { kind: "stop", request: { consumer: ROOT } },
    before: flip,
  },
  {
    name: "stop | stop (silent)",
    codex: { hook: "stop", fixture: "stop" },
    opencode: { kind: "stop", request: { consumer: ROOT } },
  },
  {
    name: "endTurn | interrupt (silent)",
    codex: { hook: "interrupt", fixture: "interrupt", mode: "app-server" },
    opencode: { kind: "endTurn", request: { consumer: ROOT } },
  },
  {
    name: "end child | subagent-stop (silent)",
    codex: { hook: "subagent-stop", fixture: "subagent-stop" },
    opencode: { kind: "end", request: { sessions: [], consumers: [CHILD] } },
    before: registerBoth,
  },
];

interface Row {
  pair: string;
  rounds: number;
  opencodeP95: number;
  codexP95: number;
  gap: number;
}

let opencodeDist = { dir: "", cleanup: () => {} };
let codexDist = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  [opencodeDist, codexDist] = await Promise.all([buildOpencodeBundles(), buildCodexBundles()]);
}, 120_000);
afterAll(() => {
  opencodeDist.cleanup();
  codexDist.cleanup();
});

describe("the OpenCode bridge's per-hook cost beside Codex's", () => {
  it(`stays within ${MARGIN_MS} ms p95 of the matching Codex hook at calm load`, async () => {
    const r = seeded();
    const dir = runtimeDir();
    await liveSocket(join(dir, `squeal-${r.worktreeId}.sock`));
    const quiet = quietCli().cli;
    Object.assign(process.env, { XDG_RUNTIME_DIR: dir, SQUEAL_CLI: quiet });
    // The Codex hooks get the environment the bridge inherits.
    const env = { ...process.env } as Record<string, string>;
    const host = { worktree: r.root, pid: process.pid };
    const bridge = async (kind: OcKind, request: object) => {
      const command: BridgeCommand = {
        node: process.execPath,
        entry: join(opencodeDist.dir, "hooks", bridgeFile(kind)),
      };
      const event = { kind, ...request, ...host } as OcRequest;
      const started = performance.now();
      const answer = await callBridge<object>(command, event, r.root, 2_000);
      return { ms: performance.now() - started, answer };
    };
    const codex = async (pair: Pair) => {
      const input = codexRecorded(
        pair.codex.mode ?? "exec",
        pair.codex.fixture,
        r.root,
        IN_SESSION,
      );
      const out = await runBundle(pair.codex.hook, input, env, codexDist.dir);
      expect(out.code, `${pair.name}: ${out.stderr}`).toBe(0);
      return out;
    };

    const rows: Row[] = [];
    let bare = Number.NaN;
    try {
      // Both sides registered before the first timed call.
      await codex(PAIRS[0] as Pair);
      await bridge("register", { consumer: ROOT });
      const asserted = calm();
      const [runs, maxRounds] = asserted ? [RUNS, ROUNDS] : [LOADED_RUNS, 1];
      const started = performance.now();
      const pings: number[] = [];
      for (let run = 0; run < runs; run++) pings.push((await bridge("ping", {})).ms);
      bare = p95(pings);
      for (const pair of PAIRS) {
        let best: Row | null = null;
        let rounds = 0;
        const late = performance.now() - started > REPORT_BY_MS;
        while (!late && rounds < maxRounds && (best === null || best.gap >= MARGIN_MS)) {
          rounds++;
          const oc: number[] = [];
          const cx: number[] = [];
          for (let run = 0; run < runs; run++) {
            // Alternate which side goes first, so neither always meets the other's after-effects.
            const sides = [
              async () => {
                pair.before?.(r, run);
                const { ms, answer } = await bridge(pair.opencode.kind, pair.opencode.request);
                expect(answer, pair.name).not.toBeNull();
                oc.push(ms);
              },
              async () => {
                pair.before?.(r, run);
                const out = await codex(pair);
                if (pair.name.endsWith("(silent)")) expect(out.stdout, pair.name).toBe("");
                cx.push(out.ms);
              },
            ];
            if (run % 2 === 1) sides.reverse();
            for (const side of sides) await side();
          }
          const row = {
            pair: pair.name,
            rounds,
            opencodeP95: Math.round(p95(oc)),
            codexP95: Math.round(p95(cx)),
            gap: Math.round(p95(oc) - p95(cx)),
          };
          if (best === null || row.gap < best.gap) best = row;
        }
        if (best !== null) rows.push({ ...best, rounds });
      }
      const load = loadavg();
      console.log(
        `OpenCode bridge beside Codex hooks, p95 ms, best of up to ${maxRounds} rounds of ${runs} ` +
          `cold runs, interleaved; bare bridge (ping) p95 ${Math.round(bare)}; load ` +
          `${load.map((l) => l.toFixed(2)).join(" ")}` +
          (asserted ? "" : `, above ${MAX_LOAD} or in CI: reported only`),
      );
      console.table(rows);
      if (!asserted || !calm()) return;
      expect(rows).toHaveLength(PAIRS.length);
      for (const row of rows) expect(row.gap, row.pair).toBeLessThan(MARGIN_MS);
    } finally {
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.SQUEAL_CLI;
    }
  }, 400_000);
});
