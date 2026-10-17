import { afterEach, describe, expect, it } from "vitest";
import {
  describeFailure,
  renormalizeFingerprint,
  sameFingerprint,
} from "../../src/core/state/fingerprint.js";
import type { CheckError, SourceLocation } from "../../src/core/types/index.js";

/*
 * Task 011-14 (issue 28): ports and temp paths a re-run draws afresh. The
 * pairs are the issue's and the research probe's
 * (`docs/specifications/011-core/research/probes/issue-28/fingerprint-probe.mjs`).
 */

const at: SourceLocation = { path: "test/serve-port.test.ts", line: 42, column: 7 };

function fp(message: string, location: SourceLocation = at, name = "AssertionError"): string {
  const error: CheckError = { name, message, stack: null, location, diff: null };
  return describeFailure([error], null).fingerprint;
}

const PORT = (port: number) =>
  `expected 'listen EADDRINUSE: address already in use 127.0.0.1:${port}' to match /port ${port}.*(in use|occupied)/`;
const SQUEAL_TMP = (key: string, suffix: string, file = "cli.js") =>
  `ENOENT: no such file or directory, open '/tmp/squeal-1001/tmp/${key}/cez-installed-workers-${suffix}/packages/cezar/dist/${file}'`;

const originalTmpdir = process.env.TMPDIR;
afterEach(() => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
});

describe("fingerprint of an ephemeral port", () => {
  it("is the same for the issue's two ports", () => {
    expect(fp(PORT(35321))).toBe(fp(PORT(34963)));
    expect(fp(PORT(35321))).toContain("127.0.0.1:<port>");
    expect(fp(PORT(35321))).toContain("/port <port>.*");
  });

  it("masks a port after localhost, a bracketed IPv6 address and a URL's host", () => {
    expect(fp("connect ECONNREFUSED localhost:8080")).toBe(
      fp("connect ECONNREFUSED localhost:8081"),
    );
    expect(fp("connect ECONNREFUSED [::1]:40001")).toBe(fp("connect ECONNREFUSED [::1]:40002"));
    expect(fp("fetch http://example.test:51234/health failed")).toBe(
      fp("fetch http://example.test:51999/health failed"),
    );
    expect(fp("server listening on Port 3000")).toBe(fp("server listening on Port 3001"));
  });

  it("keeps a source line and column, four-digit lines included", () => {
    expect(fp("thrown at src/server.ts:1234:5")).not.toBe(fp("thrown at src/server.ts:1235:5"));
    expect(fp("thrown at /repo/src/server.ts:1234")).not.toBe(
      fp("thrown at /repo/src/server.ts:1235"),
    );
    expect(fp("thrown at server.ts:1234:5")).not.toBe(fp("thrown at server.ts:1235:5"));
    expect(fp("same message", { ...at, line: 1234 })).not.toBe(
      fp("same message", { ...at, line: 1235 }),
    );
  });

  it("keeps a host, and numbers that follow neither a host nor the word port", () => {
    expect(fp("connect ECONNREFUSED 127.0.0.1:3000")).not.toBe(
      fp("connect ECONNREFUSED 10.0.0.1:3000"),
    );
    expect(fp("expected 35321 to be 34963")).not.toBe(fp("expected 35321 to be 34964"));
    expect(fp("expected 'a:35321' to be 'b'")).not.toBe(fp("expected 'a:34963' to be 'b'"));
    expect(fp("expected 1 to be 2 // Object.is equality")).not.toBe(
      fp("expected 1 to be 3 // Object.is equality"),
    );
  });
});

describe("fingerprint of a temp path", () => {
  it("is the same for the issue's two Squeal temp paths, keeping the tail", () => {
    const one = fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD"));
    expect(one).toBe(fp(SQUEAL_TMP("68148c3087e48114", "jzfwcE")));
    expect(one).toContain("'<tmp>/packages/cezar/dist/cli.js'");
  });

  it("is the same whichever daemon's temp directory is the root", () => {
    const fromTmp = fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD"));
    process.env.TMPDIR = "/tmp/squeal-1001/tmp/6db45f9b91a3d272";
    expect(fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD"))).toBe(fromTmp);
    expect(fp(SQUEAL_TMP("68148c3087e48114", "jzfwcE"))).toBe(fromTmp);
  });

  it("reads its roots at use", () => {
    const message = (dir: string) => `cannot open ${dir}/run/out.json`;
    process.env.TMPDIR = "/scratch/one";
    expect(fp(message("/scratch/one/a"))).toBe(fp(message("/scratch/one/b")));
    process.env.TMPDIR = "/scratch/two";
    expect(fp(message("/scratch/one/a"))).not.toBe(fp(message("/scratch/one/b")));
    expect(fp(message("/scratch/two/a"))).toBe(fp(message("/scratch/two/b")));
  });

  it("keeps two failures in different files under one random temp directory apart", () => {
    const run = "/tmp/vitest-AbC123/repo";
    expect(fp(`ENOENT: open '${run}/src/a.json'`)).not.toBe(fp(`ENOENT: open '${run}/src/b.json'`));
    expect(fp(`ENOENT: open '${run}/src/a.json'`)).toContain("'<tmp>/repo/src/a.json'");
    expect(
      fp("cannot read /tmp/squeal-1001/tmp/6db45f9b91a3d272/w-QI9brD/pkg/a/index.js"),
    ).not.toBe(fp("cannot read /tmp/squeal-1001/tmp/6db45f9b91a3d272/w-QI9brD/pkg/b/index.js"));
  });

  it("keeps a changed tail, a named segment and a path outside any root", () => {
    expect(fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD"))).not.toBe(
      fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD", "main.js")),
    );
    expect(fp("cannot open /tmp/run/my-module/a.js")).not.toBe(
      fp("cannot open /tmp/run/my-plugin/a.js"),
    );
    expect(fp("cannot open /repo/tmp/x-AbC123/a.js")).not.toBe(
      fp("cannot open /repo/tmp/x-XyZ789/a.js"),
    );
  });

  // Review wave 1.12, B1: a segment below the allocation is a name, whatever its spelling.
  it("keeps a named segment with digits or capitals below the allocation", () => {
    expect(fp("open /tmp/run/release-v12345/a.js")).not.toBe(
      fp("open /tmp/run/release-v23456/a.js"),
    );
    expect(fp("open /tmp/run/my-MODULE/a.js")).not.toBe(fp("open /tmp/run/my-PLUGIN/a.js"));
    expect(fp("open /tmp/run/release-v12345/a.js")).toContain("<tmp>/release-v12345/a.js");
  });

  // Review wave 1.12, B2: the allocation below Squeal's root reads `<tmp>` whatever its case.
  it("is the same for any suffix of the allocation below Squeal's scratch root", () => {
    const open = (suffix: string, file = "cli.js") =>
      `open /tmp/squeal-1001/tmp/6db45f9b91a3d272/cez-installed-workers-${suffix}/packages/${file}`;
    expect(fp(open("abcdef"))).toBe(fp(open("ghijkl")));
    expect(fp(open("byytfc"))).toBe(fp(open("QI9brD")));
    expect(fp(open("abcdef"))).toContain("open <tmp>/packages/cli.js");
    expect(fp(open("abcdef"))).not.toBe(fp(open("ghijkl", "main.js")));
  });

  it("finds Squeal's scratch root of another worktree's key below any temp root", () => {
    process.env.TMPDIR = "/scratch/t";
    const open = (root: string, alloc: string) => `open ${root}/squeal-501/tmp/${alloc}/x/a.js`;
    expect(fp(open("/scratch/t", "k1"))).toBe(fp(open("/scratch/t", "k2")));
    expect(fp(open("/scratch/t", "k1"))).toContain("open <tmp>/a.js");
    // The scratch root itself, nothing below it: the allocation is `squeal-501`.
    expect(fp("open /tmp/squeal-501/tmp/k1")).toContain("open <tmp>/tmp/k1");
  });
});

describe("renormalizeFingerprint", () => {
  // What the rules before task 011-14 stored for the issue's pairs.
  const stored = [
    "AssertionError: expected 'listen EADDRINUSE: address already in use 127.0.0.1:34963' to match /port 34963.*(in use|occupied)/ @ test/serve-port.test.ts:42:7",
    "AssertionError: ENOENT: no such file or directory, open '<tmp>/tmp/<hex>/cez-installed-workers-jzfwcE/packages/cezar/dist/cli.js' @ test/serve-port.test.ts:42:7",
    "AssertionError: ENOENT: no such file or directory, open '<tmp>/packages/cezar/dist/cli.js' @ test/serve-port.test.ts:42:7",
  ];

  it("gives a fingerprint the previous rules stored the same failure's fresh one", () => {
    expect(renormalizeFingerprint(stored[0] ?? "")).toBe(fp(PORT(35321)));
    expect(renormalizeFingerprint(stored[1] ?? "")).toBe(
      fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD")),
    );
    expect(renormalizeFingerprint(stored[2] ?? "")).toBe(
      fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD")),
    );
  });

  it("leaves a current fingerprint, its location and one without a message alone", () => {
    for (const f of [
      fp(PORT(35321)),
      fp(SQUEAL_TMP("6db45f9b91a3d272", "QI9brD")),
      fp("open /tmp/run/release-v12345/a.js"),
      fp("timed out after 5012ms at 2026-10-17T07:40:01.123Z"),
      fp("expected 0x7ffe to be 9e4f2a1b3c5d6e7f80"),
    ]) {
      expect(renormalizeFingerprint(f)).toBe(f);
    }
    expect(renormalizeFingerprint("fail @ test/a.test.ts:3:1")).toBe("fail @ test/a.test.ts:3:1");
    expect(renormalizeFingerprint("Error: open /tmp/x/a.js @ /tmp/run-AbC123/a.test.ts:1:1")).toBe(
      "Error: open <tmp>/a.js @ /tmp/run-AbC123/a.test.ts:1:1",
    );
  });
});

describe("sameFingerprint", () => {
  it("compares a stored fingerprint with a fresh one under the current rules", () => {
    expect(sameFingerprint(stored(34963), fp(PORT(35321)))).toBe(true);
    expect(sameFingerprint(stored(34963), fp("expected 1 to be 3"))).toBe(false);
    expect(sameFingerprint(null, null)).toBe(true);
    expect(sameFingerprint(null, fp(PORT(35321)))).toBe(false);
  });

  // Review wave 1.12, S1: the name may hold the delimiter the message follows.
  it("reads the name with the message, wherever the first ': ' falls", () => {
    const where = { path: "test/a.test.ts", line: 1, column: 1 };
    const fresh = fp("boom", where, "Error: port 12345");
    expect(fresh).toBe("Error: port 12345: boom @ test/a.test.ts:1:1");
    expect(renormalizeFingerprint(fresh)).toBe("Error: port <port>: boom @ test/a.test.ts:1:1");
    expect(sameFingerprint(renormalizeFingerprint(fresh), fresh)).toBe(true);
    expect(
      sameFingerprint(
        fp("boom", where, "listen 127.0.0.1:4000: refused"),
        fp("boom", where, "listen 127.0.0.1:4001: refused"),
      ),
    ).toBe(true);
    expect(sameFingerprint(fresh, fp("bang", where, "Error: port 12345"))).toBe(false);
  });
});

/** The pre-011-14 fingerprint of `PORT(port)`: the message as it was. */
function stored(port: number): string {
  return `AssertionError: ${PORT(port)} @ test/serve-port.test.ts:42:7`;
}
