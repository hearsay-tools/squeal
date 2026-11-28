import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { REPORT } from "../../../../../../test/runner-host/fake-channel.js";
import { background, REF, setup } from "../../../../../../test/runner-host/remote/lane-fixture.js";

const B = { project: "", path: "test/b.test.ts" };
const inputs = [
  ["closure", "packages/cezar/dist/hsq.js"],
  ["observed", "packages/cezar/web/dist/index.html"],
] as const;

for (const [mode, input] of inputs) {
  for (const whenLost of ["not-run", "local"] as const) {
    for (const lane of ["background", "group:tests"] as const) {
      it(`${mode} ${whenLost} ${lane}`, async () => {
        let lastRun = () => "";
        const s = await setup({
          whenLost,
          lanes: ["background", "group"],
          files: { ".gitignore": "dist/\n", "test/b.test.ts": "test fixture\n" },
          before: (root) => {
            mkdirSync(dirname(join(root, input)), { recursive: true });
            writeFileSync(join(root, input), "local build input\n");
          },
          closure: (file) => [
            file.path,
            ...(file.path === B.path && mode === "closure" ? [input] : []),
          ],
          remoteRun: async () => {
            const files = lastRun().split(",").map((path) => ({ project: "", path }));
            return {
              ...REPORT,
              completedFiles: files,
              observed: files.map((testFile) => ({
                testFile,
                paths: testFile.path === B.path && mode === "observed" ? [input] : [],
                directories: [],
              })),
            };
          },
        });
        lastRun = () => s.remoteRuns.at(-1) ?? "";
        const report = await s.lane.run([REF, B], background({ lane }));
        expect(existsSync(join(s.root, input))).toBe(true);
        expect(existsSync(join(s.remoteRoot, input))).toBe(false);
        expect(s.logs.filter((line) => line.includes("sending again"))).toEqual([]);
        expect(s.remoteRuns).toHaveLength(1);
        expect(report.completedFiles.map((file) => file.path).sort()).toEqual(
          whenLost === "local" ? [REF.path, B.path] : [REF.path],
        );
        expect(s.localFiles).toEqual(whenLost === "local" ? [B.path] : []);
        if (whenLost === "not-run") {
          expect(report.failure).toBe(
            `remote box refused (git-ignored input ${input} exists locally and is not synced to remote); not run here (whenLost "not-run")`,
          );
        } else {
          expect(report.failure).toBeNull();
        }
        console.log(JSON.stringify({ mode, input, whenLost, lane, completed: report.completedFiles,
          localFiles: s.localFiles, remoteRuns: s.remoteRuns, failure: report.failure }));
      });
    }
  }
}
