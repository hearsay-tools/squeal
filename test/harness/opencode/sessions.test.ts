import { describe, expect, it } from "vitest";
import { deadlineIn } from "../../../src/harness/opencode/deadline.js";
import { sessions } from "../../../src/harness/opencode/sessions.js";
import { CHILD_ID, ROOT_ID, stubClient } from "./stub.js";

/*
 * Spec 008 D2's walk from a session to its root: a root is `(id, main)`, a
 * child `(root, child)`, and a walk that never reaches a session without a
 * parent leaves the identity unresolved (review 008-16 S2).
 */

const resolve = (client: ReturnType<typeof stubClient>, id: string) =>
  sessions(client).consumerOf(id, deadlineIn(2_000));

describe("consumerOf", () => {
  it("is a root's own session, and a child's root and id", async () => {
    const client = stubClient([{ id: ROOT_ID }, { id: CHILD_ID, parentID: ROOT_ID }]);
    expect(await resolve(client, ROOT_ID)).toEqual({ sessionId: ROOT_ID });
    expect(await resolve(client, CHILD_ID)).toEqual({ sessionId: ROOT_ID, agentId: CHILD_ID });
  });

  it("is unresolved on an ancestry cycle (review 008-16 S2)", async () => {
    const client = stubClient([
      { id: "a", parentID: "b" },
      { id: "b", parentID: "a" },
    ]);
    expect(await resolve(client, "a")).toBeNull();
    expect(await resolve(client, "b")).toBeNull();
  });

  it("is unresolved past the deepest chain it walks, and resolves one within it (review 008-16 S2)", async () => {
    const chain = (length: number) =>
      Array.from({ length }, (_, i) => ({
        id: `s${i}`,
        ...(i === 0 ? {} : { parentID: `s${i - 1}` }),
      }));
    const long = stubClient(chain(30));
    expect(await resolve(long, "s29")).toBeNull();
    const short = stubClient(chain(4));
    expect(await resolve(short, "s3")).toEqual({ sessionId: "s0", agentId: "s3" });
  });
});
