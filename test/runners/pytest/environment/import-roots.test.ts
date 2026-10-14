import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importRoots } from "../../../../src/runners/pytest/environment/import-roots.js";
import { SITE, tempDir, venv, write } from "./tree.js";

/*
 * Spec 007 D4: "Resolution models `sys.path` from files: `pyvenv.cfg` for
 * site-packages, `.pth` path lines in file-name order, the setuptools
 * `MAPPING` and hatchling `map_module` literals of import-hook editables."
 */

describe("importRoots (spec 007 D4 inputs)", () => {
  it("reads site-packages and the stdlib from pyvenv.cfg", () => {
    const env = venv(tempDir(), ".venv");
    expect(importRoots(env)).toEqual({
      stdlib: [
        "/opt/uv/python/cpython-3.13-linux-x86_64-gnu/lib/python3.13",
        "/opt/uv/python/cpython-3.13-linux-x86_64-gnu/lib/python3.13/lib-dynload",
      ],
      sitePackages: join(env, SITE),
      pthPaths: [],
      mapped: [],
      systemSitePackages: false,
    });
  });

  it("appends .pth path lines in file-name order, existing ones once", () => {
    const root = tempDir();
    for (const dir of ["src", "packages/other/src", "rel"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    const env = venv(root, ".venv", {
      // Hatchling's default editable and setuptools' static one: setuptools' sorts first.
      "_editable_impl_app.pth": `${join(root, "src")}\n`,
      "__editable__.other-0.1.0.pth": `# comment\n\n${join(root, "packages/other/src")}\n`,
      "dupe.pth": `${join(root, "src")}\n/does/not/exist\n`,
      "relative.pth": "../../../../rel  \n",
      ".hidden.pth": `${join(root, "rel")}\n`,
      "notes.txt": `${join(root, "rel")}\n`,
    });
    expect(importRoots(env).pthPaths).toEqual([
      join(root, "packages/other/src"),
      join(root, "src"),
      join(root, "rel"),
    ]);
  });

  it("reads setuptools' MAPPING and editables' map_module from the modules .pth lines import", () => {
    const root = tempDir();
    const env = venv(root, ".venv", {
      "__editable__.spkg-0.1.pth":
        "import __editable___spkg_0_1_finder; __editable___spkg_0_1_finder.install()\n",
      "__editable___spkg_0_1_finder.py": [
        "import sys",
        `MAPPING: dict[str, str] = {'spkg': '${root}/s/lib_src', "solo": "${root}/s/solo.py"}`,
        "NAMESPACES: dict[str, list[str]] = {}",
        "",
      ].join("\n"),
      "_hpkg.pth": "import _editable_impl_hpkg\n",
      "_editable_impl_hpkg.py": [
        "from editables.redirector import RedirectingFinder as F",
        "F.install()",
        `F.map_module('hpkg', '${root}/h/src/hpkg/__init__.py')`,
        "",
      ].join("\n"),
      "_virtualenv.pth": "import _virtualenv\n",
      "_virtualenv.py": "def patch(): pass\n",
      "unused_finder.py": `MAPPING = {'ghost': '/ghost'}\n`,
    });
    expect(importRoots(env).mapped).toEqual([
      { module: "spkg", path: `${root}/s/lib_src`, finder: "setuptools" },
      { module: "solo", path: `${root}/s/solo.py`, finder: "setuptools" },
      { module: "hpkg", path: `${root}/h/src/hpkg/__init__.py`, finder: "editables" },
    ]);
  });

  it("reads a quote inside a path literal", () => {
    const env = venv(tempDir(), ".venv", {
      "a.pth": "import a_finder\n",
      "a_finder.py": `MAPPING = {'a': "/w/it's/src"}\n`,
    });
    expect(importRoots(env).mapped).toEqual([
      { module: "a", path: "/w/it's/src", finder: "setuptools" },
    ]);
  });

  it("finds site-packages without a version in pyvenv.cfg, and none in a bare directory", () => {
    const root = tempDir();
    write(root, { "conda/lib/python3.12/site-packages/x.pth": "" });
    expect(importRoots(join(root, "conda"))).toMatchObject({
      stdlib: [],
      sitePackages: join(root, "conda/lib/python3.12/site-packages"),
    });
    expect(importRoots(join(root, "nothing"))).toMatchObject({ sitePackages: null, pthPaths: [] });
  });

  it("notes include-system-site-packages", () => {
    const root = tempDir();
    write(root, {
      "env/pyvenv.cfg": "home = /usr/bin\nversion = 3.12.3\ninclude-system-site-packages = true\n",
      "env/lib/python3.12/site-packages/.keep": "",
    });
    expect(importRoots(join(root, "env"))).toMatchObject({
      stdlib: ["/usr/lib/python3.12", "/usr/lib/python3.12/lib-dynload"],
      systemSitePackages: true,
    });
  });
});
