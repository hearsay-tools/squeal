import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type EndpointsOptions,
  endpointsAfter,
  endpointsBefore,
} from "../../src/core/ci/endpoints.js";
import { FILE_CONCURRENCY } from "../../src/core/fs/concurrency.js";
import { hashFile } from "../../src/core/hash/blob.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { initRepo, tempDir } from "../hash/git-repo.js";

/*
 * Row 018-61 (review 0.1.582 S1, spec 018 D30, D20.2): each end of `ci
 * record`'s endpoint hashing gives up past `max(floor, multiple ×
 * projected)`, the projection being the time all its paths take at the rate
 * measured so far, counted once as many paths as are read at once are
 * hashed. Past the limit it reads no further path and says why.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A repository whose commit holds `count` files. */
function repo(count: number): string {
  const { path, cleanup } = tempDir("squeal-endpoints-limit-");
  cleanups.push(cleanup);
  const files = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`f/${String(i).padStart(4, "0")}.txt`, `${i}\n`]),
  );
  initRepo(path, files);
  return path;
}

const never = new Promise<never>(() => {});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the endpoint hashing's limit", () => {
  it("gives up at the floor when no read ends, and starts no read after it", async () => {
    const root = repo(200);
    let started = 0;
    const release: (() => void)[] = [];
    const options: EndpointsOptions = {
      limit: { floorMs: 200, multiple: 4 },
      hashFile: async (path, format) => {
        started++;
        await new Promise<void>((resolve) => release.push(resolve));
        return hashFile(path, format);
      },
    };
    const begin = performance.now();
    const before = await endpointsBefore(root, "sha1", options);
    const took = performance.now() - begin;
    // The two listings end; every file read stalls.
    expect(before).toBe("hashing the checkout passed its limit of 0.2 s (2 of 202 paths)");
    expect(took).toBeGreaterThanOrEqual(190);
    expect(took).toBeLessThan(5_000);
    // The stalled reads end; the paths not yet read are never read.
    expect(started).toBe(FILE_CONCURRENCY);
    for (const resolve of release.splice(0)) resolve();
    await delay(50);
    expect(started).toBe(FILE_CONCURRENCY);
  });

  it("gives up near a multiple of the measured time when one read stalls", async () => {
    const root = repo(300);
    const stalled = join(root, "f/0007.txt") as AbsolutePath;
    const options: EndpointsOptions = {
      limit: { floorMs: 100, multiple: 4 },
      hashFile: async (path, format) => {
        if (path === stalled) return never;
        await delay(20);
        return hashFile(path, format);
      },
    };
    const begin = performance.now();
    const before = await endpointsBefore(root, "sha1", options);
    const took = performance.now() - begin;
    expect(before).toMatch(
      /^hashing the checkout passed its limit of \d+\.\d s \(301 of 302 paths\)$/,
    );
    // 302 paths at 20 ms, 64 at once, take about 100 ms: the limit is past the floor.
    const limit = Number(/of (\d+\.\d) s/.exec(before as string)?.[1]) * 1000;
    expect(limit).toBeGreaterThan(100);
    // The note rounds the limit to 0.1 s.
    expect(took).toBeGreaterThanOrEqual(limit - 60);
    expect(took).toBeLessThan(limit + 2_000);
  });

  it("finishes past the floor while reads keep ending at the measured rate", async () => {
    const root = repo(300);
    const options: EndpointsOptions = {
      limit: { floorMs: 60, multiple: 4 },
      hashFile: async (path, format) => {
        await delay(25);
        return hashFile(path, format);
      },
    };
    const begin = performance.now();
    const before = await endpointsBefore(root, "sha1", options);
    if (typeof before === "string") throw new Error(before);
    expect(performance.now() - begin).toBeGreaterThan(60);
    expect(before.hashes).toHaveLength(302);
    expect(before.hashes.every((hash) => hash !== null)).toBe(true);
  });

  it("gives up after the command when a read stalls there, with the same limit", async () => {
    const root = repo(10);
    let command = false;
    const options: EndpointsOptions = {
      limit: { floorMs: 200, multiple: 4 },
      hashFile: (path, format) => (command ? never : hashFile(path, format)),
    };
    const before = await endpointsBefore(root, "sha1", options);
    if (typeof before === "string") throw new Error(before);
    command = true;
    const begin = performance.now();
    expect(await endpointsAfter(before)).toMatch(
      /^hashing the checkout passed its limit of 0\.2 s \(\d+ of 12 paths\)$/,
    );
    expect(performance.now() - begin).toBeLessThan(5_000);
  });

  it("keeps the normal result when every read ends in time", async () => {
    const root = repo(5);
    const before = await endpointsBefore(root, "sha1");
    if (typeof before === "string") throw new Error(before);
    const ends = await endpointsAfter(before);
    expect(ends).toEqual({
      stable: { "./": expect.any(String) },
      unstable: [],
      ms: expect.any(Number),
    });
  });
});
