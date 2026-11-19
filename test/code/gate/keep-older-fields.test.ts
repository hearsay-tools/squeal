import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withoutNewFields, writeThroughDaemon } from "../../../src/core/code/gate/keep-sent.js";
import type { Kept } from "../../../src/core/code/gate/keep-write.js";
import type { WorktreeKeys } from "../../../src/core/scheduler/keying.js";
import type { AbsolutePath, WorktreeId } from "../../../src/core/types/common.js";
import type { CheckKey } from "../../../src/core/types/keys.js";
import type { ResultRecord } from "../../../src/core/types/store-records.js";

/*
 * Review wave-14 N1: a daemon before row 023-22 refuses an error's `stage`
 * and `assertionEvidence` (`"write.records[0]" "errors[0]" has the unknown
 * field "stage"`), and no handover replaces a serving daemon when a newer
 * CLI runs. The gate's writer sends the results once more without those
 * two fields, which (review wave-14 B2) can then never prove a red side.
 * The receiver here checks each error's fields as `keep-protocol.ts` did at
 * 85bf54763 (its list and its words), and answers a taken write as kept.
 */

/** `checkError`'s field list in `src/core/daemon/keep-protocol.ts` before row 023-22. */
const PREVIOUS_FIELDS = [
  "name",
  "message",
  "stack",
  "location",
  "diff",
  "loadAverage",
  "code",
  "causes",
  "phase",
  "recorder",
];

/** The previous parser's refusal of one keep request's results, or `null` when it takes them. */
function previousRefusal(write: { records?: { errors?: Record<string, unknown>[] }[] }) {
  for (const [r, record] of (write.records ?? []).entries())
    for (const [e, error] of (record.errors ?? []).entries()) {
      const extra = Object.keys(error).find((field) => !PREVIOUS_FIELDS.includes(field));
      if (extra !== undefined)
        return `"write.records[${r}]" "errors[${e}]" has the unknown field "${extra}"`;
    }
  return null;
}

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A socket that answers `keep` as a daemon with the previous parser; the writes it was sent. */
async function previousDaemon() {
  const dir = mkdtempSync(join(tmpdir(), "sq-keep-older-"));
  dirs.push(dir);
  const socketPath = join(dir, "d.sock") as AbsolutePath;
  const sent: { records: ResultRecord[] }[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const request = JSON.parse(buffer.slice(0, end));
      sent.push(request.write);
      const why = previousRefusal(request.write);
      const answer =
        why === null
          ? {
              schemaVersion: 1,
              ok: true,
              type: "keep",
              requestId: request.id,
              outcome: { kept: true },
            }
          : { schemaVersion: 1, ok: false, error: why };
      socket.end(`${JSON.stringify(answer)}\n`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { socketPath, sent };
}

const KEY = "a".repeat(64) as CheckKey;
const FILE = {
  ref: { project: "", path: "test/a.test.ts" },
  key: KEY,
  paths: [],
} as unknown as Kept;
const KEYS = { environmentFiles: () => [] } as unknown as WorktreeKeys;

const failing = (error: Record<string, unknown>): ResultRecord =>
  ({
    check: { kind: "test", project: "", testPath: "test/a.test.ts", fullName: "t" },
    key: KEY,
    outcome: "fail",
    errors: [
      { name: "Error", message: "wait failed", stack: null, location: null, diff: null, ...error },
    ],
  }) as unknown as ResultRecord;

describe("results to a daemon before row 023-22 (review wave-14 N1)", () => {
  it.each([
    ["stage", { stage: "body" }],
    ["assertionEvidence", { assertionEvidence: true }],
    ["both", { stage: "hook", assertionEvidence: true }],
  ])("sends the results once more without %s, and they are kept", async (_label, fields) => {
    const daemon = await previousDaemon();
    const writer = writeThroughDaemon({
      socketPath: daemon.socketPath,
      worktreeId: "w" as WorktreeId,
      storeSchema: 1,
    });
    await expect(writer.results(FILE, [failing(fields)], KEYS)).resolves.toBe("kept");
    expect(daemon.sent).toHaveLength(2);
    expect(previousRefusal(daemon.sent[0] as never)).toMatch(/has the unknown field/);
    const [error] = daemon.sent[1]?.records[0]?.errors ?? [];
    expect(error).toEqual({
      name: "Error",
      message: "wait failed",
      stack: null,
      location: null,
      diff: null,
    });
  });

  it("sends once to a daemon that takes the fields, and never resends another refusal", async () => {
    const daemon = await previousDaemon();
    const writer = writeThroughDaemon({
      socketPath: daemon.socketPath,
      worktreeId: "w" as WorktreeId,
      storeSchema: 1,
    });
    await expect(writer.results(FILE, [failing({})], KEYS)).resolves.toBe("kept");
    expect(daemon.sent).toHaveLength(1);
    const other = await previousDaemon();
    const refusing = writeThroughDaemon({
      socketPath: other.socketPath,
      worktreeId: "w" as WorktreeId,
      storeSchema: 1,
    });
    await expect(refusing.results(FILE, [failing({ extra: 1 })], KEYS)).rejects.toThrow(
      'has the unknown field "extra"',
    );
    expect(other.sent).toHaveLength(1);
  });

  it("leaves every other field of the records as it was", () => {
    const record = failing({ stage: "body", assertionEvidence: true, code: "E1", phase: "load" });
    const [stripped] = withoutNewFields([record]);
    expect(stripped).toEqual({
      ...record,
      errors: [
        {
          name: "Error",
          message: "wait failed",
          stack: null,
          location: null,
          diff: null,
          code: "E1",
          phase: "load",
        },
      ],
    });
  });
});
