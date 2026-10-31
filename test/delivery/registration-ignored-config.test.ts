import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { squealVersion } from "../../src/core/daemon/version.js";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { Consumer } from "../../src/core/types/index.js";
import { CODE_OFF } from "../helpers/policy.js";
import { appendRevisions, fakeRepo } from "../status/helpers.js";
import { open } from "../store/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Row 011-275 (gh-120): the session's first notice names the configuration
 * keys a runtime here does not apply, as status does, and nothing without them.
 */

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const OWN = squealVersion();
const RULE = { project: "e2e", tests: ["e2e/*.e2e.ts"], paths: [".ai/qa/test-env.json"] };

function registered(config: object, daemon: string) {
  const repo = fakeRepo();
  writeFileSync(join(repo.main, "squeal.config.json"), `${JSON.stringify(config)}\n`);
  const store = open(repo.commonDir);
  appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
  store.worktrees.upsert({
    id: repo.mainId,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal.sock",
      startedAt: 1,
      heartbeatAt: NOW - 1_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: daemon,
    },
  });
  const delivery = createDelivery(store, { status: fixedStatus(), now: () => NOW });
  const consumer: Consumer = { worktreeId: repo.mainId, sessionId: "s1", agentId: "main" };
  return { repo, registration: delivery.register(consumer) };
}

describe("the registration names ignored configuration (011-275)", () => {
  it("an unknown key and runtimeFiles beside a daemon of 0.1.368: the lines status prints", async () => {
    const config = { ...CODE_OFF, runtimeFiles: [RULE], futureKey: true };
    const { repo, registration } = registered(config, "0.1.368");
    const r = await registration;
    const status = readStatus(repo.main, { now: () => NOW });

    expect(r.ignoredConfig).toEqual([
      { key: "futureKey", by: "command", version: OWN, daemonVersion: "0.1.368" },
      expect.objectContaining({ key: "runtimeFiles", by: "daemon", version: "0.1.368" }),
    ]);
    expect(status.available && status.ignoredConfig).toEqual(r.ignoredConfig);
    const lines = formatRegistration(r, undefined, "squeal", NOW)
      .split("\n")
      .filter((l) => l.startsWith("Not applied: "));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(
      `\`squeal stop\`, then \`squeal start\`, starts squeal ${OWN} in its place.`,
    );
  });

  it("only known keys: no field and no line", async () => {
    const r = await registered({ ...CODE_OFF, runtimeFiles: [RULE] }, OWN).registration;

    expect(r).not.toHaveProperty("ignoredConfig");
    expect(formatRegistration(r, undefined, "squeal", NOW)).not.toContain("Not applied");
  });
});
