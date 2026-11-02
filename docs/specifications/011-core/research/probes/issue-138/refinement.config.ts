import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['docs/specifications/011-core/research/probes/issue-138/refinement.probe.ts'],maxWorkers:1,testTimeout:60000,hookTimeout:30000}});
