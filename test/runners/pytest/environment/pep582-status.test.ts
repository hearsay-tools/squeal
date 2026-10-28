import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../../../src/cli/main.js";
import { appendNote } from "../../../../src/core/notes.js";
import type { StatusSnapshot } from "../../../../src/core/types/index.js";
import { environmentState } from "../../../../src/runners/pytest/environment/states.js";
import { appendRevisions, fakeRepo, seedStore } from "../../../status/helpers.js";
import { write } from "./tree.js";

/*
 * Task 007-59: the `use_venv = false` refusal, as the adapter notes it under
 * the project's environment topic, reaches `squeal status --full` and
 * `squeal status --json` whole, the stand-in included.
 */

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function run(argv: string[], cwd: string): string {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
    now: () => NOW,
    env: {},
  };
  main(argv, io);
  return stdout;
}

describe("the PEP 582 note in status (task 007-59)", () => {
  it("names the stand-in in text and JSON status", () => {
    const repo = fakeRepo();
    write(repo.main, { "services/app/pdm.toml": "python.use_venv = false\n" });
    const state = environmentState(repo.main, {
      name: "app",
      args: [],
      env: {},
      include: ["tests/test_*.py"],
      cwd: "services/app",
    });
    if (state.state !== "none") throw new Error("Expected no admitted environment");
    const store = seedStore(repo);
    appendRevisions(store, repo.mainId, 1, { head: null, dirty: false });
    appendNote(store, repo.mainId, {
      at: NOW,
      revision: null,
      text: state.note,
      topic: "pytest-environment:app",
    });

    const text = run(["status", "--full"], repo.main);
    const json = JSON.parse(run(["status", "--json"], repo.main)) as StatusSnapshot;
    const listed = json.daemonNotes.map((n) => n.text);
    expect(listed).toEqual([state.note]);
    expect(text).toContain(`  ${new Date(NOW).toISOString()}: ${state.note}\n`);
    for (const shown of [text, ...listed]) {
      expect(shown).toContain(
        "run `PDM_USE_VENV=true pdm use -f`, then `PDM_USE_VENV=true pdm install`, in services/app: they create `.venv` there and leave `pdm.toml` unchanged.",
      );
      expect(shown).toContain(
        "They also rewrite `.pdm-python` to name that `.venv`, so a later plain `pdm run` there uses the `.venv` too.",
      );
    }
  });
});
