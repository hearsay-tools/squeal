import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";

/*
 * Row 025-18: a hook loads `squeal.config.json` up to nine times. A load of
 * unchanged text reuses the earlier result; any edit is seen by the next load
 * in the same process, since the daemon and Pi's and OpenCode's workers live on.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-policy-reuse-"));
  dirs.push(dir);
  return dir;
}

describe("loadPolicy reuse (row 025-18)", () => {
  it("returns the same result while the file's text is unchanged", () => {
    const dir = root();
    writeFileSync(join(dir, POLICY_FILE), '{"stop": {"waitMs": 100}}');
    const first = loadPolicy(dir);
    expect(loadPolicy(dir)).toBe(first);
    // Rewritten with the same text: still the same.
    writeFileSync(join(dir, POLICY_FILE), '{"stop": {"waitMs": 100}}');
    expect(loadPolicy(dir)).toBe(first);
  });

  it("sees an edit of the same size made at once", () => {
    const dir = root();
    writeFileSync(join(dir, POLICY_FILE), '{"stop": {"waitMs": 100}}');
    expect(loadPolicy(dir).policy.stop.waitMs).toBe(100);
    // Same length, same inode, likely the same mtime tick: only the text tells.
    writeFileSync(join(dir, POLICY_FILE), '{"stop": {"waitMs": 200}}');
    expect(loadPolicy(dir).policy.stop.waitMs).toBe(200);
  });

  it("sees a file created, broken and removed", () => {
    const dir = root();
    const file = join(dir, POLICY_FILE);
    expect(loadPolicy(dir).problems).toEqual([]);
    writeFileSync(file, '{"stop": {"waitMs": 300}}');
    expect(loadPolicy(dir).policy.stop.waitMs).toBe(300);
    writeFileSync(file, "{");
    expect(loadPolicy(dir).unparsed).toBe(true);
    unlinkSync(file);
    const missing = loadPolicy(dir);
    expect(missing.problems).toEqual([]);
    expect(missing.policy.stop.waitMs).toBe(0);
  });

  it("keeps roots apart", () => {
    const [a, b] = [root(), root()];
    writeFileSync(join(a, POLICY_FILE), '{"stop": {"waitMs": 100}}');
    writeFileSync(join(b, POLICY_FILE), '{"stop": {"waitMs": 200}}');
    expect(loadPolicy(a).policy.stop.waitMs).toBe(100);
    expect(loadPolicy(b).policy.stop.waitMs).toBe(200);
    expect(loadPolicy(a).policy.stop.waitMs).toBe(100);
  });
});
