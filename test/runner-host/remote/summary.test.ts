import { describe, expect, it } from "vitest";
import {
  type LaneReport,
  remoteSummaryLine,
  type SummaryInput,
} from "../../../src/core/runner-host/remote/summary.js";

/*
 * Spec 026 D12.1 (row 026-20, lessons D2): the remote's one line in plain
 * `squeal status`: provider and machine, state, lanes and runners,
 * planning, environment mode, and the last proof or the reason.
 */

const AT = Date.UTC(2026, 10, 24, 12, 0, 0);

function line(reports: readonly LaneReport[], over: Partial<SummaryInput> = {}): string {
  return remoteSummaryLine({
    provider: "agent37",
    machine: "agent37:eu:vm:abc123",
    lanes: ["background", "edit"],
    runners: ["vitest", "node-test"],
    planning: "remote",
    environmentMode: "match-local",
    reports,
    degradedDisk: null,
    released: false,
    ...over,
  });
}

describe("the remote summary line (row 026-20)", () => {
  it("names an awake machine with its newest proof", () => {
    expect(
      line([
        { state: "ready", provenAt: AT - 1000 },
        { state: "ready", provenAt: AT },
      ]),
    ).toBe(
      "agent37 agent37:eu:vm:abc123: awake; background and edit runs of vitest, node-test; planning remote; environment match-local; proven at 2026-11-24T12:00:00.000Z",
    );
  });

  it("names a refusal and its reason before any other lane's state", () => {
    const reports: LaneReport[] = [
      { state: "ready", provenAt: AT },
      { state: "refused", reason: "degraded disk: 26 ms/sync, limit 10 ms" },
    ];
    expect(line(reports, { machine: "cmd:lan-1", provider: "command" })).toBe(
      "command cmd:lan-1: refused (degraded disk: 26 ms/sync, limit 10 ms); background and edit runs of vitest, node-test; planning remote; environment match-local",
    );
  });

  it("names an unreachable remote, and the target before a machine is acquired", () => {
    expect(
      line([{ state: "unreachable", reason: "ssh exited 255" }], {
        provider: "ssh",
        machine: "build-box",
      }),
    ).toMatch(/^ssh build-box: unreachable \(ssh exited 255\); /);
    expect(line([{ state: "not connected" }], { machine: null })).toMatch(
      /^agent37: not connected; /,
    );
  });

  it("names a degraded disk the runs go to anyway", () => {
    expect(
      line([{ state: "ready" }], { degradedDisk: "degraded disk: 26 ms/sync, limit 10 ms" }),
    ).toMatch(
      /^agent37 agent37:eu:vm:abc123: degraded-disk \(degraded disk: 26 ms\/sync, limit 10 ms\); /,
    );
  });

  it("names connecting, sleeping and released", () => {
    expect(line([{ state: "ready" }, { state: "connecting" }])).toMatch(/: connecting; /);
    expect(line([{ state: "asleep" }, { state: "asleep" }])).toMatch(/: sleeping; /);
    expect(line([{ state: "ready" }], { released: true })).toMatch(/: released; /);
  });

  it("names the remote machine its results are keyed to under remote-key", () => {
    expect(
      line([{ state: "ready", machine: "linux/riscv64, Node v26.13.0" }], {
        environmentMode: "remote-key",
      }),
    ).toContain("; environment remote-key (linux/riscv64, Node v26.13.0)");
  });
});
