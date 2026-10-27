import { describe, expect, it } from "vitest";
import {
  createReleaseDescriptor,
  parseReleaseDescriptor,
  releaseTagFor,
  serializeReleaseDescriptor,
  versionOfTag,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { failure } from "./fixture.js";

/*
 * Row 002-30 (wave-4-contract.md): the release descriptor names the runtime
 * version, its own release tag and commit, the fixed artifact name and the
 * artifact's SHA-256, and parses back only when it holds together.
 */

const SHA = "a".repeat(64);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("release descriptors", () => {
  it("roundtrips with fixed key order", () => {
    const descriptor = createReleaseDescriptor({
      version: "0.1.900",
      sha256: SHA,
      releaseCommit: COMMIT,
    });
    const text = serializeReleaseDescriptor(descriptor);
    expect(Object.keys(JSON.parse(text))).toEqual([
      "schema",
      "version",
      "releaseTag",
      "releaseCommit",
      "artifact",
      "sha256",
    ]);
    expect(parseReleaseDescriptor(text, "squeal--v0.1.900")).toEqual({
      schema: 1,
      version: "0.1.900",
      releaseTag: "squeal--v0.1.900",
      releaseCommit: COMMIT,
      artifact: "squeal-codex-runtime.json.gz",
      sha256: SHA,
    });
  });

  it("maps versions to tags and back", () => {
    expect(releaseTagFor("0.1.900")).toBe("squeal--v0.1.900");
    expect(versionOfTag("squeal--v0.2.0-rc.1")).toBe("0.2.0-rc.1");
    expect(versionOfTag("v0.2.0")).toBeNull();
    expect(versionOfTag("squeal--v0.2.0/../x")).toBeNull();
  });

  it("refuses a short commit, a bad hash and an unsafe version at creation", () => {
    expect(
      failure(() =>
        createReleaseDescriptor({ version: "0.1.900", sha256: SHA, releaseCommit: "0123456" }),
      ).message,
    ).toContain("full lowercase commit");
    expect(
      failure(() =>
        createReleaseDescriptor({ version: "0.1.900", sha256: "x", releaseCommit: COMMIT }),
      ).message,
    ).toContain("sha256");
    expect(
      failure(() =>
        createReleaseDescriptor({ version: "../1", sha256: SHA, releaseCommit: COMMIT }),
      ).code,
    ).toBe("descriptor");
  });

  const valid = (): Record<string, unknown> =>
    JSON.parse(
      serializeReleaseDescriptor(
        createReleaseDescriptor({ version: "0.1.900", sha256: SHA, releaseCommit: COMMIT }),
      ),
    );

  it.each([
    ["another schema", { schema: 2 }, "unsupported schema 2"],
    ["a tag of another version", { releaseTag: "squeal--v0.1.899" }, "is not the tag of 0.1.900"],
    ["another artifact name", { artifact: "../squeal.tgz" }, "artifact must be"],
    ["an extra key", { url: "https://example.com" }, "must hold exactly"],
    ["an uppercase hash", { sha256: SHA.toUpperCase() }, "sha256 must be lowercase hex"],
  ])("refuses %s", (_name, edit, text) => {
    const error = failure(() => parseReleaseDescriptor(JSON.stringify({ ...valid(), ...edit })));
    expect({ code: error.code, message: error.message }).toEqual({
      code: "descriptor",
      message: expect.stringContaining(text),
    });
  });

  it("refuses a descriptor downloaded from another release, and non-JSON", () => {
    const text = JSON.stringify(valid());
    expect(failure(() => parseReleaseDescriptor(text, "squeal--v0.1.901")).message).toBe(
      "descriptor names release squeal--v0.1.900, downloaded from squeal--v0.1.901",
    );
    expect(failure(() => parseReleaseDescriptor("<html>")).message).toBe("descriptor is not JSON");
  });
});
