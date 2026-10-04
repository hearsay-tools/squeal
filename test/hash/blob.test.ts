import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobHash, hashFile } from "../../src/core/hash/index.js";
import { gitHashObject, initRepo, tempDir, writeFile } from "./git-repo.js";

const samples: Readonly<Record<string, Buffer>> = {
  text: Buffer.from("export const a = 1;\nconsole.log('zażółć');\n"),
  binary: Buffer.concat([Buffer.from([0, 1, 2, 255, 0, 13, 10]), randomBytes(4096)]),
  empty: Buffer.alloc(0),
  crlf: Buffer.from("line one\r\nline two\r\n\r\n"),
};

describe("blobHash", () => {
  const dir = tempDir();
  const sha1Repo = join(dir.path, "sha1");
  const sha256Repo = join(dir.path, "sha256");

  beforeAll(() => {
    initRepo(sha1Repo, {});
    initRepo(sha256Repo, {}, { objectFormat: "sha256" });
    for (const [name, bytes] of Object.entries(samples)) {
      writeFile(sha1Repo, name, bytes);
      writeFile(sha256Repo, name, bytes);
    }
  });
  afterAll(() => dir.cleanup());

  for (const name of Object.keys(samples)) {
    it(`matches git hash-object for a ${name} file (sha1)`, () => {
      const bytes = samples[name] as Buffer;
      expect(blobHash(bytes, "sha1")).toBe(gitHashObject(sha1Repo, name));
    });

    it(`matches git hash-object for a ${name} file (sha256)`, () => {
      const bytes = samples[name] as Buffer;
      expect(blobHash(bytes, "sha256")).toBe(gitHashObject(sha256Repo, name));
    });
  }

  it("hashes a file on disk, or returns null when it is missing", async () => {
    expect(await hashFile(join(sha1Repo, "crlf"), "sha1")).toBe(gitHashObject(sha1Repo, "crlf"));
    expect(await hashFile(join(sha1Repo, "missing"), "sha1")).toBeNull();
  });
});
