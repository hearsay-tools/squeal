import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { installedDependenciesFingerprint } from "../../../src/core/keys/environment.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import { packFiles, treeBlob } from "../../../src/core/runner-host/remote/tree-wire.js";
import {
  counted,
  countedPnpm,
  earlierRecord,
  PNPM,
  pnpmInstall,
  restoreMoved,
  writePnpmProject,
} from "./pnpm-project.js";

/*
 * Review 0.1.454 B1, with real pnpm: a remote tree whose `installed.json` an
 * earlier release wrote (`{ locks, modules }`, no fingerprint) is made again
 * from scratch once, so a restored install whose link times moved comes
 * back to the lockfile's; a plain repeat install leaves it as it is
 * ("Lockfile is up to date"). A healthy earlier record is made again once
 * too, then never again.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-tree-install-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** A remote tree of the pnpm project, sent and installed once; and this side's healthy install. */
async function installedTree() {
  const dir = join(scratch, `t${++n}`);
  const here = join(dir, "here");
  writePnpmProject(here, join(dir, "pnpm"));
  pnpmInstall(here);
  const root = join(dir, "remote", "root");
  const count = join(dir, "installs");
  const tree = createTreeHost(root, () => {}, countedPnpm(join(dir, "bin"), count));
  const names = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "dep-1.0.0.tgz"];
  const read = names.map((path) => {
    const bytes = readFileSync(join(here, path));
    return { entry: { path, blob: treeBlob(bytes) }, bytes };
  });
  await tree.write({ ...(await packFiles(read)), removed: [] });
  expect(await tree.install()).toEqual({ ran: true, command: "pnpm install --frozen-lockfile" });
  const fingerprint = () => installedDependenciesFingerprint(root, root);
  const healthy = await installedDependenciesFingerprint(here, here);
  expect(await fingerprint()).toBe(healthy);
  return { tree, root, count, fingerprint, healthy, record: join(dir, "remote/installed.json") };
}

const AGAIN = { ran: true, command: "pnpm install --frozen-lockfile", again: true };

describe.skipIf(PNPM === null)(
  "an earlier release's install record, with real pnpm (review 0.1.454 B1)",
  // Each test runs real pnpm installs; the 5 s default fails on a loaded host.
  { timeout: 60_000 },
  () => {
    it("makes a restored install again from scratch once, back to the lockfile's", async () => {
      const t = await installedTree();
      earlierRecord(t.record);
      restoreMoved(t.root);
      expect(await t.fingerprint()).not.toBe(t.healthy);
      expect(await t.tree.install()).toEqual(AGAIN);
      expect(await t.fingerprint()).toBe(t.healthy);
      expect(await t.tree.install()).toEqual({ ran: false, command: null });
      expect(counted(t.count)).toBe(2);
    });

    it("makes a healthy install again once too, then keeps it", async () => {
      const t = await installedTree();
      earlierRecord(t.record);
      expect(await t.tree.install()).toEqual(AGAIN);
      expect(await t.fingerprint()).toBe(t.healthy);
      expect(await t.tree.install()).toEqual({ ran: false, command: null });
      expect(counted(t.count)).toBe(2);
    });

    it("makes a restored install with a current record again from scratch too", async () => {
      const t = await installedTree();
      restoreMoved(t.root);
      expect(await t.tree.install()).toEqual(AGAIN);
      expect(await t.fingerprint()).toBe(t.healthy);
    });
  },
);
