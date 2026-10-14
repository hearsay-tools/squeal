import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OcClient, OcHooks, OcSessionInfo } from "../../../src/harness/opencode/api.js";
import { type SquealPluginOptions, squealPlugin } from "../../../src/harness/opencode/plugin.js";
import type { OcRequest } from "../../../src/harness/opencode/protocol.js";
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

export interface StubClient extends OcClient {
  readonly logged: string[];
  readonly lookups: string[];
}

/** A client that knows `sessions`; `get` of any other id is an HTTP 404, as the SDK returns it. */
export function stubClient(sessions: readonly OcSessionInfo[] = []): StubClient {
  const logged: string[] = [];
  const lookups: string[] = [];
  return {
    logged,
    lookups,
    session: {
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

/** A bridge that records every request in `log` and answers `register` with `HEADER`; `stall` never answers. */
export function stubBridge(behaviour: "answer" | "fail" | "stall" = "answer"): {
  entry: string;
  requests: () => OcRequest[];
} {
  const dir = tempDir("squeal-oc-stub-");
  const log = join(dir, "requests.jsonl");
  const entry = join(dir, "bridge.mjs");
  writeFileSync(
    entry,
    `import { appendFileSync, readFileSync } from "node:fs";
const request = JSON.parse(readFileSync(0, "utf8"));
appendFileSync(${JSON.stringify(log)}, JSON.stringify(request) + "\\n");
const behaviour = ${JSON.stringify(behaviour)};
if (behaviour === "stall") setInterval(() => {}, 1000);
else if (behaviour === "fail") process.exitCode = 1;
else {
  const answers = { register: { header: ${JSON.stringify(HEADER)} }, end: { ended: 1 }, ping: { pong: true } };
  process.stdout.write(JSON.stringify({ answer: answers[request.kind] }));
}
`,
  );
  const requests = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as OcRequest)
      : [];
  return { entry, requests };
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
  return squealPlugin({
    bin: "/pkg/bin",
    env: { PATH: "/usr/bin" },
    findNode: async () => process.execPath,
    ...options,
  })({ client, directory, worktree: directory });
}

/** `chat.message`'s output for a message of `sessionID`. */
export function chatOutput(sessionID: string, id = MESSAGE_ID) {
  return {
    message: { id, sessionID },
    parts: [{ id: "prt_0", sessionID, messageID: id, type: "text", text: "hello" }] as unknown[],
  };
}
