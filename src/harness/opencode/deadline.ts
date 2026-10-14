/*
 * Spec 008 D4: one deadline bounds a whole hook, every wait in it included
 * (review 008-15). Runs in OpenCode's Bun: no imports.
 */

/** What is left of a hook's deadline, in ms. */
export type Deadline = () => number;

/** The deadline `ms` from now. */
export function deadlineIn(ms: number): Deadline {
  const end = performance.now() + ms;
  return () => Math.max(0, end - performance.now());
}

/** Resolves `promise`, or `null` past `ms` or on a rejection. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
