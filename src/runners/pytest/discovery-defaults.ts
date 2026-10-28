/** Installed PDM packages hold dependency tests, outside broad project discovery. */
const DEPENDENCY_DIRECTORY = "__pypackages__";
const GLOB = /[*?[{]/;

/** Paths here are relative to a pytest project's cwd. */
export function isDependencyPath(path: string): boolean {
  return path.split("/").includes(DEPENDENCY_DIRECTORY);
}

/** Only a literal path through the dependency directory opts an include in. */
export function rootedDependencyIncludes(include: readonly string[]): string[] {
  return include.filter((glob) => {
    const segments = (glob.startsWith("./") ? glob.slice(2) : glob).split("/");
    for (const segment of segments.slice(0, -1)) {
      if (GLOB.test(segment)) return false;
      if (segment === DEPENDENCY_DIRECTORY) return true;
    }
    return false;
  });
}

/** A rooted opt-in stays available; the adapter limits it to its matching files. */
export function defaultDiscoveryExcludes(include: readonly string[]): string[] {
  return rootedDependencyIncludes(include).length === 0 ? [`**/${DEPENDENCY_DIRECTORY}/**`] : [];
}
