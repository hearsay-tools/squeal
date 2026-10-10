import { describe, expect, test } from "vitest";
import { addDays, daysBetween, dueDate, weekday } from "../src/clock.ts";
import { loadCalendar } from "./support/calendar-cache.ts";

describe("calendar days", () => {
  test("adds days across a month end", () => {
    expect(addDays("2026-01-30", 30)).toBe("2026-03-01");
  });

  test("names the weekday", () => {
    expect(weekday("2026-03-02")).toBe("Mon");
  });

  test("counts days between two dates", () => {
    expect(daysBetween("2026-03-02", "2026-04-01")).toBe(30);
  });
});

describe("due dates", () => {
  test("loads the holiday calendar within its budget", async () => {
    await loadCalendar();
  }, 250);

  test("is the terms after the issue date on a weekday", () => {
    expect(dueDate("2026-03-02", 30)).toBe("2026-04-01");
  });

  test("moves a Saturday due date to Monday", () => {
    expect(dueDate("2026-03-02", 12)).toBe("2026-03-16");
  });
});
