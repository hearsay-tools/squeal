/**
 * Whether `stack` has a frame of `method` in the file named `file`
 * (`"scheduler/record.ts"`), as V8 prints it, `at TierRecords.#write (…)`,
 * or as Vite 8.4.0's module runner reprints a source-mapped frame of a
 * private method, `at #write (…)`: its `CallSiteToString` writes the type
 * name only before a method name that is an identifier, and `#write` is not
 * one (row 025-30). Vite 8.3 kept the type name. Tests that find their seam
 * in the stack name the method and its file, never the type name.
 */
export function inMethod(stack: string | undefined, method: string, file: string): boolean {
  if (stack === undefined) return false;
  const frame = new RegExp(
    `\\bat (?:async )?(?:[\\w$]+\\.)?${escape(method)} \\((?:file://)?[^\\n]*/${escape(file)}:\\d`,
  );
  return frame.test(stack.replaceAll("\\", "/"));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
