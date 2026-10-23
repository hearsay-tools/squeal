import { readPolicy } from "../daemon/policy.js";
import { isTooBig } from "../delivery/code-deliver.js";
import { codeSince, type ShellSession, wentOverSince } from "../delivery/code-since.js";
import { codeSource, withCode } from "../delivery/code-source.js";
import { plural } from "../text.js";
import type { CodeStatus } from "../types/code-delivery.js";
import type { AbsolutePath, StatusSnapshot, Store, WorktreeId } from "../types/index.js";

/*
 * Spec 015 D6: status's complexity line and its `code` JSON, read from the
 * code store with no daemon (011 C6). Absent while `complexity.enabled` is
 * off, so status is then the one before (goal 1).
 */

/** `StatusSnapshot.code` of the worktree, or nothing while the policy is off. */
export function codeStatusOf(
  store: Store,
  worktreeId: WorktreeId,
  at: { readonly root: AbsolutePath; readonly commonDir: () => AbsolutePath | null },
  shell: ShellSession | null,
): { code?: CodeStatus } {
  if (!readPolicy(at.root).complexity.enabled) return {};
  const commonDir = at.commonDir();
  if (commonDir === null) return {};
  const source = codeSource(commonDir, at.root);
  const since = () => codeSince(store, worktreeId, shell);
  const read = withCode(source, ({ store: code, complexity }) =>
    code.read((): CodeStatus => {
      const states = code.states.list(worktreeId, { measure: "complexity" });
      const from = since();
      return {
        v: 1,
        threshold: complexity.threshold,
        over: states.filter((s) => s.outcome === "fail").length,
        sinceRegistration: from === null ? 0 : wentOverSince(code, worktreeId, from.since).length,
        since: from?.scope ?? null,
        pending: code.files.uncounted(worktreeId).length,
        files: code.files.list(worktreeId).filter((f) => !isTooBig(f)).length,
        unknown: states.filter((s) => s.outcome === "unknown").length,
      };
    }),
  );
  if (read !== "missing") return read === null ? {} : { code: read };
  const threshold = source.policy()?.threshold;
  if (threshold === undefined) return {};
  return {
    code: {
      v: 1,
      threshold,
      over: 0,
      sinceRegistration: 0,
      since: null,
      pending: 0,
      files: 0,
      unknown: 0,
    },
  };
}

const SINCE: Record<NonNullable<CodeStatus["since"]>, string> = {
  session: "since this session started",
  oldest: "since the oldest registered session started",
};

/** D6: `Complexity: 62 functions over 20, 2 since this session started; squeal code lists them.` */
export function codeStatusLines(s: StatusSnapshot, command: string): string[] {
  const code = s.code;
  if (code === undefined) return [];
  if (code.files === 0) return ["Complexity: no file counted yet."];
  const since = code.since === null ? "" : `, ${code.sinceRegistration} ${SINCE[code.since]}`;
  const counting =
    code.pending === 0
      ? ""
      : `; counting, ${code.files - code.pending} of ${plural(code.files, "file")}`;
  const unknown =
    code.unknown === 0 ? "" : `; ${plural(code.unknown, "function")} in parse errors not judged`;
  const over = `${plural(code.over, "function")} over ${code.threshold}`;
  return [`Complexity: ${over}${since}${counting}${unknown}; ${command} code lists them.`];
}
