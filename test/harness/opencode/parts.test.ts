import { describe, expect, it } from "vitest";
import { partAfter, partId } from "../../../src/harness/opencode/plugin.js";
import {
  chatOutput,
  created,
  hook,
  ROOT_ID,
  squealDir,
  startPlugin,
  stubBridge,
  stubClient,
} from "./stub.js";

/*
 * Spec 008 D3 as amended: the part Squeal adds to a message has an id
 * starting `prt` that sorts after the message's own, or is not added.
 */

describe("the added part's id (review 008-15 S2)", () => {
  it("sorts after a last part dated later than the clock", async () => {
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = chatOutput(ROOT_ID);
    const later = partId(Date.now() + 60_000);
    output.parts = [{ ...(output.parts[0] as object), id: later }];
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    const added = (output.parts[1] as { id: string }).id;
    expect(added > later).toBe(true);
    expect(added).toMatch(/^prt/);
  });

  it("adds nothing when a part has no prt id", async () => {
    const hooks = await startPlugin(squealDir(), stubClient(), { entry: stubBridge().entry });
    await hook(hooks, "event")(created(ROOT_ID));
    const output = chatOutput(ROOT_ID);
    output.parts = [{ ...(output.parts[0] as object), id: "x_1" }];
    await hook(hooks, "chat.message")({ sessionID: ROOT_ID }, output);
    expect(output.parts).toHaveLength(1);
  });

  it("is a fresh id when that already sorts last", () => {
    const earlier = partId(Date.now() - 60_000);
    const id = partAfter([{ id: earlier }]);
    expect(id).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(id !== null && id > earlier).toBe(true);
  });
});

describe("partId", () => {
  it("is an ascending OpenCode part id for the time given", () => {
    const id = partId(1_791_991_860_085);
    expect(id).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(id.slice(0, 16) > partId(1_791_991_860_084).slice(0, 16)).toBe(true);
  });
});
