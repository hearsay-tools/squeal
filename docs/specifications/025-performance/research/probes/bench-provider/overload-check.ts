// Throwaway probe for research 025-22: would TypeScript have caught the wrapper
// against Vite 8.4.0's types? Shapes copied from vite@8.4.0 dist/node/index.d.ts
// (EnvironmentPluginContainer.load, lines 1455-1458), reduced.
// Run: pnpm exec tsc --ignoreConfig --noEmit --strict --target es2022 --lib es2022 overload-check.ts
type LoadResult = string | { code: string };
type LoadResultWithMetadata = { code?: string | null; addedImports: Set<string> | null };
interface Container84 {
  load(id: string, loadOptions: { withMetadata: true }): Promise<LoadResultWithMetadata>;
  load(id: string): Promise<LoadResult | null>;
}
declare const container: Container84;
const load = container.load.bind(container);
// Squeal's wrapper as in src/runners/vitest/sources.ts:135 at 0.1.641:
container.load = async (id: string) => load(id);
