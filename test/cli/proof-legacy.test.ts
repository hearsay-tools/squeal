import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Review wave-14 B2: a red failure stored before the runners recorded
 * where in its test an error happened can never prove a side. The proof
 * runs that side again (unconditioned, stored as any run) and reads the
 * fresh result; the next call reads the fresh record from the store. The
 * legacy records are made as the review made them: `stage` and
 * `assertionEvidence` removed from each stored error, nothing else.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Commit A holds the bug (`value` 1); HEAD fixes it (`value` 2) and adds `test`. */
function sourceFix(test: string) {
  const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: test });
  return { f, a };
}

const lines = (...text: string[]) => [...text, ""].join("\n");

/**
 * Strips the two fields this row added from every stored failure text, as
 * the review did; how many errors lost one. A text's id is its hash
 * (`storeFailureText`), so each stripped text gets the id it would have
 * had when stored, and its results point at it: the fresh text of a later
 * run then gets an id of its own, as it would after a real upgrade.
 */
function makeLegacy(f: Fixture): number {
  const db = new DatabaseSync(join(f.root, ".git", "squeal", "store.sqlite"));
  let stripped = 0;
  try {
    const rows = db.prepare("SELECT id, summary, errors FROM failure_texts").all() as {
      id: string;
      summary: string | null;
      errors: string;
    }[];
    for (const row of rows) {
      const errors = JSON.parse(row.errors) as Record<string, unknown>[];
      for (const error of errors) {
        if ("stage" in error || "assertionEvidence" in error) stripped++;
        delete error.stage;
        delete error.assertionEvidence;
      }
      const text = JSON.stringify(errors);
      const id = createHash("sha256")
        .update(JSON.stringify([row.summary, text]))
        .digest("hex");
      db.prepare("UPDATE failure_texts SET id = ?, errors = ? WHERE id = ?").run(id, text, row.id);
      db.prepare("UPDATE results SET failure_id = ? WHERE failure_id = ?").run(id, row.id);
    }
  } finally {
    db.close();
  }
  return stripped;
}

/** Three calls: fresh, after the records were made legacy (refreshed), and reading the refresh. */
async function threeCalls(test: string) {
  const { f, a } = sourceFix(test);
  const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
  const args = { files: [TEST.path], base: a };
  const fresh = await prove(f, args, options);
  clean(f);
  const stripped = makeLegacy(f);
  const legacy = await prove(f, args, options);
  clean(f);
  const again = await prove(f, args, options);
  clean(f);
  return { fresh, stripped, legacy, again };
}

describe("squeal proof with failures stored before 023-22 (review wave-14 B2)", {
  timeout: 240_000,
}, () => {
  it("runs a legacy hook assertion's side again and reads the hook: exit 3, never proven", async () => {
    const { fresh, stripped, legacy, again } = await threeCalls(
      lines(
        'import { beforeEach, expect, it } from "vitest";',
        'import { value } from "../src/a";',
        "beforeEach(() => expect(value).toBe(2));",
        'it("body", () => {});',
      ),
    );
    expect(fresh.code, fresh.why).toBe(3);
    expect(fresh.files[0]?.red.failures[0]).toMatchObject({ kind: "hook" });
    expect(stripped).toBeGreaterThan(0);
    expect(legacy.code, legacy.why).toBe(3);
    expect(legacy.files[0]).toMatchObject({
      verdict: "red for another reason",
      reason: "a hook or the file's teardown failed",
      red: { end: "fail", from: "run", stored: true },
    });
    expect(legacy.files[0]?.red.failures[0]).toMatchObject({
      kind: "hook",
      text: expect.stringContaining("expected 1 to be 2"),
    });
    expect(again.code, again.why).toBe(3);
    expect(again.files[0]).toMatchObject({ red: { from: "store" } });
    expect(again.report.runs).toBe(0);
  });

  it("runs a legacy body assertion's side again, then proves it", async () => {
    const { fresh, legacy, again } = await threeCalls(
      lines(
        'import { expect, it } from "vitest";',
        'import { value } from "../src/a";',
        'it("value", () => expect(value).toBe(2));',
      ),
    );
    expect(fresh.code, fresh.why).toBe(0);
    expect(legacy.code, legacy.why).toBe(0);
    expect(legacy.files[0]).toMatchObject({
      verdict: "proven",
      evidence: "assertion",
      red: { end: "fail", from: "run", stored: true },
      green: { end: "pass", from: "store" },
    });
    expect(legacy.report.runs).toBe(1);
    expect(again.code, again.why).toBe(0);
    expect(again.files[0]).toMatchObject({ red: { from: "store" }, green: { from: "store" } });
    expect(again.report.runs).toBe(0);
  });

  it("runs a legacy plain Error's side again, then proves it labelled thrown", async () => {
    const { legacy, again } = await threeCalls(
      lines(
        'import { it } from "vitest";',
        'import { value } from "../src/a";',
        'it("value", () => {',
        '  if (value !== 2) throw new Error("wait failed: value is not 2");',
        "});",
      ),
    );
    expect(legacy.code, legacy.why).toBe(0);
    expect(legacy.files[0]).toMatchObject({
      verdict: "proven",
      reason: "red on a thrown error, not an assertion: Error: wait failed: value is not 2",
      evidence: "thrown",
      red: { from: "run" },
    });
    expect(again.files[0]).toMatchObject({ verdict: "proven", red: { from: "store" } });
  });
});
