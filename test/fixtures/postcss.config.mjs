// Row 011-425: an empty PostCSS config, so Vite's search for one, run for
// every fixture under this folder that a test starts Vitest in, stops here
// and never reads the root `package.json`. Without it, each such test re-runs
// on a version raise. It adds no transform, so fixtures with CSS behave as before.
export default {};
