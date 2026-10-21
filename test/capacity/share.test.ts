import { describe, expect, test } from "vitest";
import { fairShares } from "../../src/core/capacity/index.js";

/*
 * Spec 001 D11 Capacity (task 001-376): a daemon's fair share is the host's
 * slots divided by the daemons with backlog work; slots one cannot use go to
 * the others; the longest waiter is served first. Every share is permits
 * (011 C10 as amended 2026-10-21, row 011-96): there is no free worker.
 */
const shares = (...args: Parameters<typeof fairShares>) => Object.fromEntries(fairShares(...args));

describe("fairShares", () => {
  test("a lone daemon gets every slot", () => {
    expect(shares(23, [{ id: "a", want: 200, since: null }])).toEqual({ a: 23 });
  });

  test("daemons that each want more than an equal share split the slots, the remainder to the longest waiter", () => {
    expect(
      shares(23, [
        { id: "a", want: 200, since: null },
        { id: "b", want: 200, since: 5 },
      ]),
    ).toEqual({ a: 11, b: 12 });
  });

  test("slots a daemon cannot use go to the others", () => {
    expect(
      shares(24, [
        { id: "a", want: 200, since: null },
        { id: "b", want: 3, since: null },
        { id: "c", want: 200, since: null },
      ]),
    ).toEqual({ a: 11, b: 3, c: 10 });
  });

  // Row 011-96: no daemon runs a backlog worker without a permit, so a share may be 0.
  test("with fewer slots than daemons, the longest waiters get one each and the others none", () => {
    expect(
      shares(2, [
        { id: "a", want: 9, since: null },
        { id: "b", want: 9, since: 5 },
        { id: "c", want: 9, since: 3 },
      ]),
    ).toEqual({ a: 0, b: 1, c: 1 });
  });

  test("a capped project's daemons share its slots, and the rest of the host goes to the others", () => {
    const project = { id: "/repo/p", slots: 6 };
    expect(
      shares(24, [
        { id: "p1", want: 200, since: null, project },
        { id: "p2", want: 200, since: null, project },
        { id: "q", want: 200, since: null },
      ]),
    ).toEqual({ p1: 3, p2: 3, q: 18 });
  });
});
