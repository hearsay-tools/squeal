import { describe, expect, it } from "vitest";
import {
  CONTAINER_RISK,
  containerConsentEntry,
  containerConsentWarning,
  withConsentEntry,
} from "../../src/cli/setup/containers.js";
import type { ContainerTarget } from "../../src/core/types/policy-containers.js";

const target = (image: string, network?: string): ContainerTarget => ({
  image,
  ...(network === undefined ? {} : { network }),
  keyMode: "build-content",
  dockerfileInputs: [],
  dependencyServices: [],
  env: {},
});

describe("setup's container consent wording (spec 027 D4)", () => {
  it("lists each declared target's image and network, the risk and the file", () => {
    const warning = containerConsentWarning(
      { backend: target("sb/backend", "{composeProject}_default"), workers: target("sb/workers") },
      "/u/.config/squeal/containers.json",
    );
    expect(warning).toBe(
      [
        "squeal.config.json declares container targets:",
        "  - backend: image sb/backend, network {composeProject}_default",
        "  - workers: image sb/workers, Docker's default network",
        CONTAINER_RISK,
        "Squeal runs none of them until you allow them in /u/.config/squeal/containers.json.",
      ].join("\n"),
    );
    expect(CONTAINER_RISK).toContain("root-equivalent");
  });

  it("shows nothing for a repository that declares no target", () => {
    expect(containerConsentWarning({}, "/x")).toBeNull();
  });

  it("makes an enabled entry only from an explicit opt-in", () => {
    expect(containerConsentEntry({ optIn: false, targets: ["backend"] })).toBeNull();
    expect(containerConsentEntry({ optIn: true, targets: [] })).toBeNull();
    expect(
      containerConsentEntry({ optIn: true, targets: ["backend"], composeProject: "sb-dev" }),
    ).toEqual({ enabled: true, targets: ["backend"], composeProject: "sb-dev" });
  });

  it("adds the entry to containers.json and keeps every other entry", () => {
    const entry = { enabled: true, targets: ["backend"] } as const;
    expect(JSON.parse(withConsentEntry(null, "/repo", entry))).toEqual({
      allow: { "/repo": entry },
    });
    const current = JSON.stringify({ allow: { "/other": { enabled: false, targets: "all" } } });
    expect(JSON.parse(withConsentEntry(current, "/repo", entry))).toEqual({
      allow: { "/other": { enabled: false, targets: "all" }, "/repo": entry },
    });
    expect(() => withConsentEntry("[]", "/repo", entry)).toThrow("JSON object");
  });
});
