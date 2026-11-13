import type { Vitest } from "vitest/node";

/*
 * Spec 013 V8 as amended (row 020-50, #207): Vitest's pool logs one line
 * when a worker it stops outlives `teardownTimeout` after its files ended
 * (Vitest 5.0.3, `[vitest-pool]: Timeout terminating <pool> worker for test
 * files <paths>.`). The line is the logger's alone: it rejects no task and
 * reaches no reporter, and the pool awaits a worker's exit only at its next
 * cancel or close, so it can come after the run ended, during the
 * instance's close. Squeal reads it from the instance's logger.
 */

const TIMEOUT = /^\[vitest-pool\]: Timeout terminating \S+ worker for test files (.+)\.$/s;

/** The absolute test file paths a teardown timeout line names; `null` for any other message. */
export function teardownFiles(message: unknown): string[] | null {
  if (typeof message !== "string") return null;
  const listed = TIMEOUT.exec(message)?.[1];
  if (listed === undefined) return null;
  const files = listed.split(", ").filter((file) => file !== "");
  return files.length === 0 ? null : files;
}

/**
 * Tells `hear` the files of each teardown timeout line `vitest` logs, from
 * now until its close ends its pool. Every message, that one included,
 * still goes to Vitest's own `logger.error` with the same arguments; a
 * throw of `hear` goes to `note` and never to Vitest's timer. The hook is
 * removed once the close stopped the pool's workers (Vitest runs its close
 * handlers after the pool's close). It holds `hear`, `note` and the logger,
 * nothing else.
 */
export function hearTeardowns(
  vitest: Pick<Vitest, "logger" | "onClose">,
  hear: (files: readonly string[]) => void,
  note: (text: string) => void,
): void {
  const logger = vitest.logger;
  const own = Object.hasOwn(logger, "error");
  const original = logger.error;
  const hooked: typeof logger.error = function (this: unknown, ...args) {
    try {
      return original.apply(this, args);
    } finally {
      const files = teardownFiles(args[0]);
      if (files !== null) {
        try {
          hear(files);
        } catch (error) {
          note(`a Vitest teardown timeout could not be heard: ${String(error)}`);
        }
      }
    }
  };
  logger.error = hooked;
  vitest.onClose(() => {
    if (logger.error !== hooked) return;
    if (own) logger.error = original;
    else Reflect.deleteProperty(logger, "error");
  });
}
