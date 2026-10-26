import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintFileResult } from "../../../src/core/lint/provider/index.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon, fixture } from "./helpers.js";

/*
 * Review 0.1.351 B2-R3 with the real provider and pass (wave 1.7): the
 * worker loaded an unlisted rule, and the rule changed before the pass's
 * first look at it. The pass must not take that look as the bytes the
 * worker loaded: a stored result holds the findings of the bytes in its
 * key, or nothing is stored.
 */

const messages = (result: LintFileResult | undefined) =>
  result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : result;

describe("an unlisted rule edited after the worker loaded it, before the pass's first look (review 0.1.351 B2-R3)", () => {
  it("stores the edited rule's findings or nothing, and a clean second root gets the same", async () => {
    const dir = commonDir();
    const one = new FakeWorktree("w1", dir);
    fixture(one, "ts-config", undefined, ["rule.ts"]);
    const rule = join(one.root, "rule.ts");
    const after = readFileSync(rule, "utf8").replace('"before"', '"after"');
    // The install fingerprint is read after the worker loaded the config and before the
    // pass looks at `rule.ts`: an edit there falls between the two reads.
    let reads = 0;
    const first = daemon(one, () => {
      if (reads++ === 0) writeFileSync(rule, after);
      return Promise.resolve("install-1");
    });
    const a = await first.run("src/a.js");
    expect(reads).toBeGreaterThan(0);
    const fresh = messages(cli(one.root, ["src/a.js"]).get("src/a.js"));
    expect(fresh).toEqual(["after", "inline before"]);
    if (a.messages !== undefined) expect(a.messages).toEqual(fresh);

    // A revision that names no input: the stored findings are the fresh CLI's.
    one.write("README.md", "# fixture\n");
    one.revise();
    const b = await first.run("src/a.js");
    expect(b.state).toMatchObject({ outcome: "fail", stale: false });
    expect(b.messages).toEqual(fresh);
    await first.close();

    // A clean second root whose rule is `after` from the start.
    const two = new FakeWorktree("w2", dir);
    fixture(
      two,
      "ts-config",
      (path, text) => (path === "rule.ts" ? text.replace('"before"', '"after"') : text),
      ["rule.ts"],
    );
    const second = daemon(two);
    const c = await second.run("src/a.js");
    expect(c.messages).toEqual(messages(cli(two.root, ["src/a.js"]).get("src/a.js")));
    expect(c.messages).toEqual(["after", "inline before"]);
    await second.close();
  }, 180_000);
});
