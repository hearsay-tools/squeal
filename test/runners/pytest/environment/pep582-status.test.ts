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
  /*
   * Review 0.1.376: the stand-in that makes `<cwd>/.venv` whatever PDM's
   * `venv.in_project` says (B1), and the missing declared `python` (B2).
   */
  it.each([
    ["no environment", undefined, "To get one today, run"],
    [
      "a missing declared python",
      "envs/test/bin/python",
      "the project's `python` in squeal.config.json, services/app/envs/test/bin/python, does not exist",
    ],
  ])("names the stand-in in text and JSON status: %s", (_, python, expected) => {
    const repo = fakeRepo();
    write(repo.main, { "services/app/pdm.toml": "python.use_venv = false\n" });
    const state = environmentState(repo.main, {
      name: "app",
      args: [],
      env: {},
      include: ["tests/test_*.py"],
      cwd: "services/app",
      ...(python === undefined ? {} : { python }),
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
      expect(shown).toContain(expected);
      expect(shown).toContain(
        "run `PDM_VENV_IN_PROJECT=true pdm venv create`, then `PDM_USE_VENV=true pdm use --venv in-project`, then `PDM_USE_VENV=true pdm install`, in services/app. They create `.venv` there, whatever PDM's `venv.in_project` says, install into it and leave `pdm.toml` unchanged.",
      );
      expect(shown).toContain(
        "`pdm use` rewrites `.pdm-python` to name that `.venv` and, by default, writes `.python-version`.",
      );
    }
  });
});
