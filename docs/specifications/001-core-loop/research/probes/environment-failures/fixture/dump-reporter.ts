// Prints what Vitest hands a reporter for each module and suite: state and errors, cause included.
import type { Reporter, TestModule } from "vitest/node";
const short = (e: any) => ({ name: e.name, message: e.message, code: e.code, cause: e.cause && { name: e.cause.name, message: e.cause.message, code: e.cause.code } });
export default class DumpReporter implements Reporter {
  onTestModuleEnd(m: TestModule) {
    const suites = [...m.children.allSuites()].filter((s) => s.errors().length > 0);
    console.log(`DUMP module ${m.moduleId.split("/").slice(-2).join("/")} state=${m.state()} errors=${JSON.stringify(m.errors().map(short))}` +
      suites.map((s) => ` suite "${s.fullName}" state=${s.state()} errors=${JSON.stringify(s.errors().map(short))}`).join(""));
  }
  onTestRunEnd(_m: unknown, unhandled: readonly any[], reason: string) {
    console.log(`DUMP run reason=${reason} unhandled=${JSON.stringify(unhandled.map(short))}`);
  }
}
