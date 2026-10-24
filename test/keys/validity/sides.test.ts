import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { allEnded } from "./sides.js";

/*
 * The comparison runs its drivers at once (row 011-179); when one fails,
 * the others still run in the work directory the test file removes, so the
 * comparison throws only once every driver has ended.
 */

describe("drivers run at once (row 011-179)", () => {
  it("throws the first failure only after every driver has ended", async () => {
    const ended: string[] = [];
    const driver = async (name: string, ms: number, fails: boolean) => {
      await sleep(ms);
      ended.push(name);
      if (fails) throw new Error(`${name} failed`);
      return name;
    };
    await expect(
      allEnded([driver("first", 10, true), driver("second", 60, false), driver("third", 30, true)]),
    ).rejects.toThrow("first failed");
    expect(ended).toEqual(["first", "third", "second"]);
  });

  it("returns each driver's value in the order given", async () => {
    await expect(allEnded([sleep(30, "slow"), sleep(5, "fast")])).resolves.toEqual([
      "slow",
      "fast",
    ]);
  });
});
