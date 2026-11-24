import assert from "node:assert/strict";
import { remotePlanning } from "../../../../../../src/core/runner-host/remote/lane-planning.ts";
import { timeoutText } from "../../../../../../src/cli/no-verdict-lines.ts";
import { remoteLines } from "../../../../../../src/core/status/remote-status.ts";

// Throwaway source-level probe. No daemon, store, provider or network calls.
const why = "unreachable since 2026-11-24T20:06:21.678Z (synthetic setup failure)";
let localCalls = 0;
const context = {
  target: "probe-remote",
  whenLost: "not-run",
  local: { testFiles: async () => { localCalls++; return []; } },
  host: async () => null,
  send: async () => {},
  lost: () => {},
  begin: () => () => {},
  why: () => why,
  ending: () => false,
  opened: () => {},
};
await assert.rejects(remotePlanning(context).testFiles(), (error) => {
  console.log(`planning: ${error.message}`);
  return error.message.includes('not planned here (whenLost "not-run")');
});
assert.equal(localCalls, 0);
await remotePlanning({ ...context, whenLost: "local" }).testFiles();
assert.equal(localCalls, 1);
console.log("local planning calls: not-run=0, local=1");

const snapshot = {
  remote: `probe-remote: ${why}`,
  listingFailed: `remote probe-remote ${why}; not planned here (whenLost "not-run")`,
};
// Deliberately only fields this branch reads; not an end-to-end wait fixture.
const wait = { verdict: { revision: 14 }, result: snapshot };
const text = timeoutText(wait, { result: "none", reason: "lapsed" }, "squeal");
assert.equal(text, "the daemon's heartbeat had lapsed at the last read; results are as of revision 14");
assert.ok(!text.includes("probe-remote"));
console.log(`named wait timeout clause: ${text}`);
console.log(`status summary: ${remoteLines(snapshot).join("\n")}`);
