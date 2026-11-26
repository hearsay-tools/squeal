import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  containerBlock,
  listManagedContainers,
  type PsContainer,
} from "../../src/core/ps/containers.js";
import { render } from "../../src/core/ps/render.js";
import { type SnapshotOptions, takeSnapshot } from "../../src/core/ps/snapshot.js";
import {
  exampleSnapshot,
  fakeWindow,
  noFlags,
  type SnapshotHost,
  snapshotHost,
} from "./fixture-snapshot.js";

/*
 * Spec 027 D7.3 (row 027-06): `squeal ps` lists the containers Squeal
 * manages, by one bounded `docker ps -a` over its label, in its text and
 * its JSON; without Docker the list is empty and ps goes on.
 */

const LISTING = [
  [
    "0123456789abcdef0123",
    "squeal-ct-wt123456-backend.pytest.api-a1b2c3",
    "running",
    "wt1234567890",
  ],
  ["fedcba9876543210fedc", "squeal-ct-wt123456-workers.pytest.w-d4e5f6", "exited", "wt1234567890"],
]
  .map(([id, name, state, wt], i) =>
    [
      id,
      name,
      state,
      wt,
      i === 0 ? "backend" : "workers",
      "sha256:img",
      i === 0 ? "42" : "99",
    ].join("\t"),
  )
  .join("\n");

describe("the managed container list (D7.3)", () => {
  test("lists only Squeal's managed containers, with each owner read", async () => {
    const asked: string[][] = [];
    const found = await listManagedContainers(
      async (args) => {
        asked.push([...args]);
        return `${LISTING}\n`;
      },
      (pid) => pid === 42,
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.[0]).toBe("ps");
    expect(asked[0]).toContain("--all");
    expect(asked[0]).toContain("--filter=label=org.squeal.managed=true");
    expect(found).toEqual([
      {
        id: "0123456789ab",
        name: "squeal-ct-wt123456-backend.pytest.api-a1b2c3",
        state: "running",
        worktree: "wt1234567890",
        target: "backend",
        image: "sha256:img",
        pid: 42,
        ownerAlive: true,
      },
      expect.objectContaining({ id: "fedcba987654", state: "exited", pid: 99, ownerAlive: false }),
    ]);
  });

  test("is empty, never failing, without Docker or with one that does not answer", async () => {
    const absent = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    expect(await listManagedContainers(() => Promise.reject(absent))).toEqual([]);
    expect(
      await listManagedContainers(() =>
        Promise.reject(new Error("Cannot connect to the Docker daemon")),
      ),
    ).toEqual([]);
  });

  test("renders a block naming each container and its owner, and nothing for none", () => {
    const containers: PsContainer[] = [
      {
        id: "0123456789ab",
        name: "squeal-ct-a",
        state: "running",
        worktree: "w",
        target: "backend",
        image: "sha256:img",
        pid: 42,
        ownerAlive: true,
      },
      {
        id: "fedcba987654",
        name: "squeal-ct-b",
        state: "exited",
        worktree: "w",
        target: "workers",
        image: "sha256:img",
        pid: 99,
        ownerAlive: false,
      },
    ];
    expect(containerBlock([])).toEqual([]);
    expect(containerBlock(containers)).toEqual([
      "",
      "Squeal containers",
      "  0123456789ab  squeal-ct-a  running  target backend · daemon 42",
      "  fedcba987654  squeal-ct-b  exited  target workers · daemon 99 gone, removed at the next start",
    ]);
    const text = render(exampleSnapshot({ containers }), { full: false });
    expect(text).toContain("Squeal containers");
    expect(render(exampleSnapshot(), { full: false })).not.toContain("Squeal containers");
  });
});

describe("a snapshot's containers", () => {
  let host: SnapshotHost;
  beforeEach(() => {
    host = snapshotHost();
  });
  afterEach(() => rmSync(host.base, { recursive: true, force: true }));

  const snap = (overrides: Partial<SnapshotOptions>) => {
    const window = fakeWindow(() => {});
    return takeSnapshot({
      source: host.source,
      places: host.places,
      flag: noFlags,
      full: false,
      repo: false,
      sampleMs: 2_000,
      now: window.now,
      wait: window.wait,
      ...overrides,
    });
  };

  test("holds what the lister found, in the JSON too, and nothing without a lister", async () => {
    const one = (
      await listManagedContainers(
        async () => LISTING,
        () => true,
      )
    ).slice(0, 1);
    const shape = await snap({ containers: async () => one });
    expect(shape.containers).toEqual(one);
    expect(JSON.parse(JSON.stringify(shape)).containers).toHaveLength(1);
    expect(await snap({})).not.toHaveProperty("containers");
    const failed = await snap({ containers: () => Promise.reject(new Error("docker gone")) });
    expect(failed.containers).toEqual([]);
  });
});
