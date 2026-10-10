/**
 * Bumped when the adapter changes what a result, closure or environment means,
 * so the environment hash re-keys every check of this runner (001 D3, D4).
 * Alone in its file, which the key-format guard exempts (task 001-203), so a
 * bump leaves `KEY_FORMAT_VERSION` and the other runners' keys alone.
 *
 * "2": the environment holds what the preloads loaded at run time (review
 * wave 2, B1), so a pass stored before that was recorded runs once more and
 * records it. "3": the recorder is installed before `--require` preloads too
 * (review wave 2.5, B1), so a pass stored while they went unobserved runs once more. "4": a
 * quoted `--require` in `NODE_OPTIONS` gets the recorder first too (review
 * wave 2.6, B1), so a pass stored while its loads went unobserved runs once more.
 * "5": closures and the environment report their installed packages (task
 * 003-22), and the graph reads `NODE_OPTIONS`' preloads, so keys change shape.
 * "6": a package is taken from the installed path a specifier resolves to, and
 * template imports, `createRequire` and `process.getBuiltinModule` report
 * `module` (task 003-33, review wave 3, B1 and B2), so a pass stored under a
 * key that missed a package runs once more. "7": a slow project's spawned
 * processes are recorded, and a load whose parent is no module and that is no
 * preload joins the test file rather than the preloads (rows 003-37, 004-19),
 * so a pass stored while those loads went unkeyed runs once more. "8": a load
 * with no loaded parent that a preload made before the process's entry point,
 * a preload's `createRequire`, joins the preloads rather than every test file
 * (row 003-39, 004 review S1), so observed keys change shape. "9": only the
 * test file's own process marks that phase, never a worker thread or a
 * process the test spawns (row 003-40, 004 re-review S2, S3), so what they
 * load before their entry joins the test file rather than the environment.
 */
export const NODE_TEST_ADAPTER_VERSION = "9";
