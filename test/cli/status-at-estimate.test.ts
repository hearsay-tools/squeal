import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-40 (D7.3): `--run` tells the queueing estimate of what the
 * commit daemon selected, and how to narrow it, when it runs past the
 * wait. Row 023-41 removed this file's in-call run test (row 023-19, P3).
 */

const A1 = ref("test/a1.test.ts");
const A2 = ref("test/a2.test.ts");
const Z = ref("test/z.test.ts");
const ZZ = ref("test/zz.test.ts");

/** Commit A with four tests, and HEAD changing `src/a.ts`, which they read. */
function four() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 2;\n",
    ...Object.fromEntries([A1, A2, Z, ZZ].map((file) => [file.path, testOf("a", 2)])),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  return { f, a };
}

describe("status --at --run: the queueing estimate (row 023-40)", SLOW, () => {
  it("tells the estimate and how to narrow it when the selection runs past the wait (row 023-40)", async () => {
    const { f, a } = four();
    withStore(f, (store) =>
      store.results.putMany(
        [A1, A2].map((file) => ({ ...result(check(file.path), "elsewhere"), durationMs: 900_000 })),
      ),
    );
    // Row 023-40c: the commit daemon selects the four files; the call tells the estimate of them.
    const daemons = standIn(standInTree(f), () => undefined, { select: () => [A1, A2, Z, ZZ] });
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: daemons.ports,
    };
    const cut = await run(f, { commit: a, run: { allMissing: false }, waitMs: 3000 }, options);
    expect(cut.err).toMatch(
      new RegExp(
        `squeal: --run: 4 test files with no result at ${a.slice(0, 9)} queued in its commit daemon, up to \\d+ at once: about \\d+ (s|min) at this machine's rate; they run on after the wait; name test files or folders to narrow it: squeal status --at ${a} <path>\\.\\.\\. --run\n`,
      ),
    );
    clean(f);
  });
});
