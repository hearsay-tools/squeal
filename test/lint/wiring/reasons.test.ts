import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { formatRegistration } from "../../../src/core/delivery/index.js";
import { NOW } from "../../status/slow-tier-seed.js";
import { FakeProvider } from "../pass/helpers.js";
import { deliveryOf, wiredRig } from "./rig.js";

/*
 * Spec 017 D8, D9: why lint says less, the same in the registration,
 * status and `squeal lint`, as the real pass recorded it: lint off (no
 * ESLint, ESLint 8, the worker's third failure), a config that does not
 * load, a file the worker could not lint. None is ever told as a pass.
 */

function cli(cwd: string, args: string[]) {
  let out = "";
  main(args, { stdout: (t) => (out += t), stderr: () => {}, cwd, now: () => NOW });
  return out.split("\n");
}

async function told(
  provider: FakeProvider,
  files: Record<string, string> = { "src/a.js": "ok\n" },
) {
  const rig = await wiredRig(files, { provider });
  const registration = await deliveryOf(rig).register(rig.consumer());
  return {
    rig,
    registration: formatRegistration(registration, undefined, "squeal", NOW).split("\n"),
    status: cli(rig.repo.main, ["status"]),
    lint: cli(rig.repo.main, ["lint", "src/a.js"]),
  };
}

describe("why lint says less (017 D8, D9)", () => {
  it("says lint is off, with the provider's reason, on every surface", async () => {
    const provider = new FakeProvider();
    provider.declaration = { off: "ESLint 8 is not supported" };
    const { registration, status, lint } = await told(provider);
    const line = "Lint: off: ESLint 8 is not supported.";
    expect(registration).toContain(line);
    expect(status).toContain(line);
    expect(lint[0]).toBe(line);
  });

  it("says a config that does not load, and lists no file as passing", async () => {
    const provider = new FakeProvider();
    provider.failInputs = "eslint.config.js does not load: SyntaxError: Unexpected token";
    const { registration, status, lint } = await told(provider);
    const line = "Lint: unknown: eslint.config.js does not load: SyntaxError: Unexpected token.";
    expect(registration).toContain(line);
    expect(status).toContain(line);
    expect(lint).toContain(line);
    expect(lint.join("\n")).not.toMatch(/no findings/);
  });

  it("names a file the worker could not lint as unknown, with its reason, never as passing", async () => {
    const provider = new FakeProvider();
    provider.unknown.set("src/a.js", "the ESLint worker timed out after 5000 ms");
    const { status, lint } = await told(provider, { "src/a.js": "ok\n", "src/b.js": "ok\n" });
    expect(status).toContain("Lint: unknown: 1 file: the ESLint worker timed out after 5000 ms.");
    expect(lint).toContain("  src/a.js: unknown: the ESLint worker timed out after 5000 ms");
    expect(lint.join("\n")).not.toMatch(/src\/a\.js: no findings/);
  });
});
