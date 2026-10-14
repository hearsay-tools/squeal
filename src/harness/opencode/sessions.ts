import type { OcClient, OcSessionInfo } from "./api.js";
import { type Deadline, within } from "./deadline.js";
import type { OcConsumer } from "./protocol.js";

/*
 * Spec 008 D2 in the plugin: the map from session id to parent id, and the
 * consumer each session is. Runs in OpenCode's Bun.
 */

/** A `task` child of a child is one more hop; the walk to the root stops here. */
const MAX_DEPTH = 8;

export const keyOf = (consumer: OcConsumer) => `${consumer.sessionId}\n${consumer.agentId ?? ""}`;

export interface Sessions {
  /** Records `info`'s parent, from `session.created` or `session.deleted`. */
  saw(info: OcSessionInfo): void;
  forget(id: string): void;
  /**
   * D2: a root session's consumer is `(id, main)`; a child's is `(root,
   * child)`. `null` when a lookup on the way failed or missed `deadline`: a
   * guess of root would register a child as `(child, main)` (review 008-15),
   * so the caller does nothing, and the next hook looks again.
   */
  consumerOf(id: string, deadline: Deadline): Promise<OcConsumer | null>;
}

export function sessions(client: OcClient): Sessions {
  /** Session id to parent id, `null` for a root. */
  const parents = new Map<string, string | null>();

  /** From the map or one `client.session.get`; `undefined` when unknown. */
  const parentOf = async (id: string, deadline: Deadline): Promise<string | null | undefined> => {
    const known = parents.get(id);
    if (known !== undefined) return known;
    const result = await within<{ data?: OcSessionInfo }>(
      client.session.get({ path: { id } }),
      deadline(),
    );
    if (result?.data === undefined) return undefined;
    const parent = result.data.parentID ?? null;
    parents.set(id, parent);
    return parent;
  };

  return {
    saw: (info) => parents.set(info.id, info.parentID ?? null),
    forget: (id) => parents.delete(id),
    async consumerOf(id, deadline) {
      let root = id;
      for (let depth = 0; depth < MAX_DEPTH; depth++) {
        const parent = await parentOf(root, deadline);
        if (parent === undefined) return null;
        if (parent === null) break;
        root = parent;
      }
      return root === id ? { sessionId: id } : { sessionId: root, agentId: id };
    },
  };
}
