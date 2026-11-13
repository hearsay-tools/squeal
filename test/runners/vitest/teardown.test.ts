import { describe, expect, it } from "vitest";
import { hearTeardowns, teardownFiles } from "../../../src/runners/vitest/teardown.js";

/*
 * Row 020-50 (#207): the teardown timeout line Vitest's pool logs, read
 * from the instance's logger (spec 013 V8 as amended).
 */

const line = (files: string) =>
  `[vitest-pool]: Timeout terminating forks worker for test files ${files}.`;

describe("teardownFiles", () => {
  it("reads the files of Vitest 5's line", () => {
    expect(teardownFiles(line("/w/test/pass.test.ts"))).toEqual(["/w/test/pass.test.ts"]);
    expect(teardownFiles(line("/w/a.test.ts, /w/b.test.ts"))).toEqual([
      "/w/a.test.ts",
      "/w/b.test.ts",
    ]);
    expect(
      teardownFiles(
        "[vitest-pool]: Timeout terminating threads worker for test files /w/a.test.ts.",
      ),
    ).toEqual(["/w/a.test.ts"]);
  });

  it("reads no other message, whatever it holds", () => {
    expect(
      teardownFiles("[vitest-pool]: Failed to terminate forks worker for test files /w/a.test.ts."),
    ).toBeNull();
    expect(teardownFiles(`prefix ${line("/w/a.test.ts")}`)).toBeNull();
    expect(teardownFiles(line("/w/a.test.ts").slice(0, -1))).toBeNull();
    expect(
      teardownFiles("[vitest-pool]: Timeout terminating forks worker for test files ."),
    ).toBeNull();
    expect(teardownFiles(new Error(line("/w/a.test.ts")))).toBeNull();
    expect(teardownFiles(undefined)).toBeNull();
  });
});

/** A Vitest instance's logger and close handlers, as `hearTeardowns` reads them. */
function instance() {
  const printed: unknown[][] = [];
  const handlers: (() => unknown)[] = [];
  class Logger {
    error(...args: unknown[]) {
      printed.push(args);
    }
  }
  const logger = new Logger();
  const vitest = {
    logger,
    onClose: (fn: () => unknown) => handlers.push(fn),
  } as unknown as Parameters<typeof hearTeardowns>[0];
  const close = () => {
    for (const handler of handlers) handler();
  };
  return { vitest, logger, printed, close };
}

describe("hearTeardowns", () => {
  it("tells the files of each teardown line and passes every message to Vitest unchanged", () => {
    const { vitest, logger, printed } = instance();
    const heard: (readonly string[])[] = [];
    const notes: string[] = [];
    hearTeardowns(
      vitest,
      (files) => heard.push(files),
      (text) => notes.push(text),
    );
    const cause = new Error("cause");
    logger.error(line("/w/a.test.ts"));
    logger.error("error during close", cause);
    logger.error(line("/w/b.test.ts, /w/c.test.ts"), "extra");
    expect(heard).toEqual([["/w/a.test.ts"], ["/w/b.test.ts", "/w/c.test.ts"]]);
    expect(printed).toEqual([
      [line("/w/a.test.ts")],
      ["error during close", cause],
      [line("/w/b.test.ts, /w/c.test.ts"), "extra"],
    ]);
    expect(printed[1]?.[1]).toBe(cause);
    expect(notes).toEqual([]);
  });

  it("hears a line logged during the close, and is removed once the close handlers run", () => {
    const { vitest, logger, printed, close } = instance();
    const heard: (readonly string[])[] = [];
    hearTeardowns(
      vitest,
      (files) => heard.push(files),
      () => {},
    );
    expect(Object.hasOwn(logger, "error")).toBe(true);
    // Vitest's close stops the pool's workers before it runs its close handlers.
    logger.error(line("/w/late.test.ts"));
    close();
    expect(Object.hasOwn(logger, "error")).toBe(false);
    logger.error(line("/w/after.test.ts"));
    expect(heard).toEqual([["/w/late.test.ts"]]);
    expect(printed).toHaveLength(2);
  });

  it("restores an own error method as it was", () => {
    const { vitest, logger, close } = instance();
    const own = (...args: unknown[]) => args;
    Object.assign(logger, { error: own });
    hearTeardowns(
      vitest,
      () => {},
      () => {},
    );
    expect(logger.error).not.toBe(own);
    close();
    expect(logger.error).toBe(own);
  });

  it("notes a listener that throws, and Vitest still prints the line", () => {
    const { vitest, logger, printed } = instance();
    const notes: string[] = [];
    hearTeardowns(
      vitest,
      () => {
        throw new Error("listener broke");
      },
      (text) => notes.push(text),
    );
    expect(() => logger.error(line("/w/a.test.ts"))).not.toThrow();
    expect(printed).toEqual([[line("/w/a.test.ts")]]);
    expect(notes).toEqual(["a Vitest teardown timeout could not be heard: Error: listener broke"]);
  });

  it("tells nothing for a line it cannot read", () => {
    const { vitest, logger, printed } = instance();
    const heard: (readonly string[])[] = [];
    hearTeardowns(
      vitest,
      (files) => heard.push(files),
      () => {},
    );
    logger.error("[vitest-pool]: Timeout terminating forks worker for test files");
    expect(heard).toEqual([]);
    expect(printed).toHaveLength(1);
  });
});
