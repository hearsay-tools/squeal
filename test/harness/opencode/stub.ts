import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OcClient, OcHooks, OcSessionInfo } from "../../../src/harness/opencode/api.js";
import { type SquealPluginOptions, squealPlugin } from "../../../src/harness/opencode/plugin.js";
import type { OcKind, OcRequest } from "../../../src/harness/opencode/protocol.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Stand-ins for the OpenCode plugin's unit tests: a client whose sessions are
 * a map, and a bridge entry that records each request and answers it, run by
 * this Node.
 */

/** Recorded session ids from the research logs (research, sessions 3: r1). */
export const ROOT_ID = "ses_ec4f634c2ffeXYZG21QrpEdkY4";
export const CHILD_ID = "ses_ec4f61774ffeIWyJMttM94R8E9";
export const MESSAGE_ID = "msg_13b09cb6c001RFZu5JnQn7fcX3";
export const HEADER = "SQUEAL · registered at revision 3\nstub header";
export const PRIMER_TEXT = "Squeal runs this repository's tests; stub primer";

export interface StubClient extends OcClient {
  readonly logged: string[];
  readonly lookups: string[];
  /** Each `promptAsync`: the session and its text. */
  readonly prompted: { id: string; text: string }[];
}

/** A client that knows `sessions`; `get` of any other id is an HTTP 404, as the SDK returns it. */
export function stubClient(sessions: readonly OcSessionInfo[] = []): StubClient {
  const logged: string[] = [];
  const lookups: string[] = [];
  const prompted: { id: string; text: string }[] = [];
  return {
    logged,
    lookups,
    prompted,
    session: {
      promptAsync: async ({ path, body }) => {
        prompted.push({ id: path.id, text: body.parts.map((part) => part.text).join("") });
        return { data: undefined };
      },
      get: async ({ path }) => {
        lookups.push(path.id);
        const data = sessions.find((s) => s.id === path.id);
        return data === undefined ? { error: { name: "NotFoundError" } } : { data };
      },
    },
    app: {
      log: async ({ body }) => {
        logged.push(body.message);
        return true;
      },
    },
  };
}

/** What `stubBridge` answers each kind, when not told otherwise. */
export const STUB_ANSWERS: Record<OcKind, unknown> = {
  register: { header: HEADER, registered: true, primer: PRIMER_TEXT },
  prompt: { text: null },
  before: { reason: null },
  after: { text: null },
  stop: { report: null },
  endTurn: { ended: true },
  wait: { text: null },
  end: { ended: 1 },
  ping: { pong: true },
};

/**
 * A bridge that records every request in `log` and answers each kind as
 * `STUB_ANSWERS` or `answers` say, after `delays`; an answer of `"stall"`
 * never comes. `unregistered` answers `register` as a worktree with no store
 * yet does; `fail` exits 1; `stall` never answers.
 */
export function stubBridge(
  behaviour: "answer" | "unregistered" | "fail" | "stall" = "answer",
  options: {
    answers?: Partial<Record<OcKind, unknown>>;
    delays?: Partial<Record<OcKind, number>>;
  } = {},
): {
  entry: string;
  requests: () => OcRequest[];
  /** The pid of each bridge process, by kind, in start order. */
  pids: (kind: OcKind) => number[];
} {
  const dir = tempDir("squeal-oc-stub-");
  const log = join(dir, "requests.jsonl");
  const pidLog = join(dir, "pids.jsonl");
  const entry = join(dir, "bridge.mjs");
  const answers = { ...STUB_ANSWERS, ...options.answers };
  if (behaviour === "unregistered")
    answers.register = { header: null, registered: false, primer: null };
  writeFileSync(
    entry,
    `import { appendFileSync, readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
appendFileSync(${JSON.stringify(log)}, JSON.stringify(request) + "\\n");
appendFileSync(${JSON.stringify(pidLog)}, JSON.stringify([request.kind, process.pid]) + "\\n");
const behaviour = ${JSON.stringify(behaviour)};
const answer = ${JSON.stringify(answers)}[request.kind];
const delay = ${JSON.stringify(options.delays ?? {})}[request.kind] ?? 0;
if (behaviour === "stall" || answer === "stall") setInterval(() => {}, 1000);
else if (behaviour === "fail") process.exitCode = 1;
else setTimeout(() => process.stdout.write(JSON.stringify({ answer })), delay);
`,
  );
  const requests = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as OcRequest)
      : [];
  const pids = (kind: OcKind) =>
    existsSync(pidLog)
      ? readFileSync(pidLog, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as [OcKind, number])
          .filter(([k]) => k === kind)
          .map(([, pid]) => pid)
      : [];
  return { entry, requests, pids };
}

/** Whether `pid` names a live process. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A directory that uses Squeal by the fast path's first test: it holds a `squeal.config.json`. */
export function squealDir(): string {
  const dir = tempDir("squeal-oc-repo-");
  writeFileSync(join(dir, "squeal.config.json"), "{}\n");
  return dir;
}

/** Starts the plugin on `directory` with this Node as the bridge's. */
export function startPlugin(
  directory: string,
  client: OcClient,
  options: Partial<SquealPluginOptions> & { entry: string },
): Promise<OcHooks> {
  const { entry, ...rest } = options;
  return squealPlugin({
    bridge: () => entry,
    bin: "/pkg/bin",
    env: { PATH: "/usr/bin" },
    findNode: async () => process.execPath,
    ...rest,
  })({ client, directory, worktree: directory });
}

/** `chat.message`'s output for a message of `sessionID`. */
export function chatOutput(sessionID: string, id = MESSAGE_ID) {
  return {
    message: { id, sessionID },
    parts: [{ id: "prt_0", sessionID, messageID: id, type: "text", text: "hello" }] as unknown[],
  };
}
