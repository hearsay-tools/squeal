import type { Case, PytestInput } from "../../case.js";

/*
 * Row 027-03, spec 027 D3: an outside editable is admitted only when it holds
 * no code. Each case is one both trees refuse, the last release by 007 D2 and
 * this one by a D3 condition, so every line of the build-stage check runs
 * with equal outputs and no key moves.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const SITE = "env/lib/python3.13/site-packages";
const FINDER = "__editable___sb_backend_0_1_0_finder";

/** A declared environment in the worktree, `sb_backend` editable from `<outside>/<dir>`. */
function editableEnv(dir: string, site: Readonly<Record<string, string>> = {}) {
  return {
    "env/pyvenv.cfg": lines("home = /usr/bin", "version_info = 3.13"),
    "env/bin/python": "",
    [`${SITE}/sb_backend-0.1.0.dist-info/direct_url.json`]: JSON.stringify({
      url: `file://<outside>/${dir}`,
      dir_info: { editable: true },
    }),
    ...Object.fromEntries(Object.entries(site).map(([path, text]) => [`${SITE}/${path}`, text])),
    "tests/test_project.py": lines("def test_pass():", "    assert True"),
  };
}

/** `sb_backend`'s RECORD and `.pth`: a comment, a blank line, an empty finder and a code-free directory. */
const RECORDED = {
  "sb_backend-0.1.0.dist-info/RECORD": lines(
    "_sb_backend.pth,sha256=x,1",
    `"${FINDER}.py",sha256=x,1`,
    "sb_backend-0.1.0.dist-info/RECORD,,",
  ),
  "_sb_backend.pth": lines(
    "# sb_backend editable",
    "",
    `import ${FINDER}; ${FINDER}.install()`,
    "<outside>/stage",
  ),
  [`${FINDER}.py`]: lines("MAPPING: dict[str, str] = {}", "NAMESPACES: dict[str, list[str]] = {}"),
};

/** A build stage beside the worktree: metadata, its own `.venv`, and `stage`, a code-free directory. */
const STAGE = {
  "pkgs/pyproject.toml": lines("[project]", 'name = "sb_backend"'),
  "pkgs/uv.lock": lines("version = 1"),
  "pkgs/.venv/lib/python3.13/site-packages/django/__init__.py": "",
  "stage/notes/readme.txt": "",
};

const refused = (
  name: string,
  why: string,
  input: Pick<PytestInput, "files" | "outside">,
): Case => ({
  kind: "adapter:pytest",
  name,
  why,
  input: {
    ...input,
    python: "3.13",
    project: { python: "env", include: ["tests/test_*.py"] },
    runs: [{ files: ["tests/test_project.py"] }],
  },
});

export const PYTEST_EDITABLE: readonly Case[] = [
  refused(
    "an outside editable with a package beside build-stage metadata is refused",
    "027 D3 and 007 D2: the .pth's comment, finder and directory all add no code, so the editable's own package refuses it; nothing runs or stores",
    {
      files: editableEnv("pkgs", RECORDED),
      outside: { ...STAGE, "pkgs/sb_backend/__init__.py": "" },
    },
  ),
  refused(
    "an outside editable whose .pth adds a directory with code is refused",
    "027 D3 and 007 D2: a code-free build stage whose .pth reaches a module elsewhere still imports outside code",
    {
      files: editableEnv("pkgs", {
        ...RECORDED,
        "_sb_backend.pth": lines("<outside>/lib"),
      }),
      outside: { ...STAGE, "lib/sb_backend.py": "" },
    },
  ),
  refused(
    "an outside editable whose .pth runs another import is refused",
    "027 D3 and 007 D2: only an empty setuptools finder may run from the .pth",
    {
      files: editableEnv("pkgs", {
        ...RECORDED,
        "_sb_backend.pth": lines("import sys; sys.path.append('/elsewhere')"),
      }),
      outside: STAGE,
    },
  ),
  refused(
    "an empty outside editable without a RECORD is refused",
    "027 D3 and 007 D2: without RECORD its .pth files are unknown",
    { files: editableEnv("pkgs"), outside: STAGE },
  ),
  refused(
    "an empty outside editable inside another checkout is refused",
    "027 D3 and 007 D2: a directory under a .git may be another worktree",
    {
      files: editableEnv("repo/pkgs", RECORDED),
      outside: { ...STAGE, "repo/.git": lines("gitdir: /elsewhere/.git/worktrees/repo") },
    },
  ),
  refused(
    "a missing outside editable is refused",
    "027 D3 and 007 D2: a directory that is not there cannot be proven empty",
    { files: editableEnv("gone", RECORDED), outside: STAGE },
  ),
];
