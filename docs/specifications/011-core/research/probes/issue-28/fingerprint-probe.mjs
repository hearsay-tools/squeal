// Throwaway probe for issue 28: does describeFailure give the same fingerprint
// to the issue's two pairs of messages? Run from the repo root:
//   node --import ./docs/specifications/011-core/research/probes/issue-28/ts-hooks.mjs \
//        docs/specifications/011-core/research/probes/issue-28/fingerprint-probe.mjs
// TMPDIR is read once, when fingerprint.ts loads (tempPrefixes() in a module const).
import { tmpdir } from "node:os";
const { describeFailure } = await import(new URL("../../../../../../src/core/state/fingerprint.ts", import.meta.url).href);

const loc = { path: "test/serve-port.test.ts", line: 42, column: 7 };
const err = (message) => [{ name: "AssertionError", message, location: loc, diff: null, phase: "test" }];
const fp = (m) => describeFailure(err(m), null).fingerprint;

// Message bodies: the issue quotes the changed fragments; the surrounding words are reconstructed.
const pairs = {
  "A port (issue)": [
    "expected 'listen EADDRINUSE: address already in use 127.0.0.1:35321' to match /port 35321.*(in use|occupied)/",
    "expected 'listen EADDRINUSE: address already in use 127.0.0.1:34963' to match /port 34963.*(in use|occupied)/",
  ],
  "B squeal tmp + mkdtemp (issue)": [
    "ENOENT: no such file or directory, open '/tmp/squeal-1001/tmp/6db45f9b91a3d272/cez-installed-workers-QI9brD/packages/cezar/dist/cli.js'",
    "ENOENT: no such file or directory, open '/tmp/squeal-1001/tmp/68148c3087e48114/cez-installed-workers-jzfwcE/packages/cezar/dist/cli.js'",
  ],
  "C control: same raw message": [
    "expected 'listen EADDRINUSE: address already in use 127.0.0.1:35321' to match /port 35321.*(in use|occupied)/",
    "expected 'listen EADDRINUSE: address already in use 127.0.0.1:35321' to match /port 35321.*(in use|occupied)/",
  ],
  "D control: genuinely changed assertion": [
    "expected 1 to be 2 // Object.is equality",
    "expected 1 to be 3 // Object.is equality",
  ],
  "E control: genuinely changed path tail": [
    "ENOENT: no such file or directory, open '/tmp/squeal-1001/tmp/6db45f9b91a3d272/cez-installed-workers-QI9brD/packages/cezar/dist/cli.js'",
    "ENOENT: no such file or directory, open '/tmp/squeal-1001/tmp/6db45f9b91a3d272/cez-installed-workers-QI9brD/packages/cezar/dist/main.js'",
  ],
  "F already handled: durations + timestamps": [
    "timed out after 5012ms at 2026-10-17T07:40:01.123Z",
    "timed out after 5230ms at 2026-10-17T07:41:55.900Z",
  ],
};

console.log(`node ${process.version}, TMPDIR=${process.env.TMPDIR ?? "(unset)"}, tmpdir()=${tmpdir()}`);
for (const [name, [a, b]] of Object.entries(pairs)) {
  const [fa, fb] = [fp(a), fp(b)];
  console.log(`\n${name}: ${fa === fb ? "SAME fingerprint" : "DIFFERENT fingerprint (fail-changed)"}`);
  console.log(`  1: ${fa}`);
  if (fa !== fb) console.log(`  2: ${fb}`);
}
