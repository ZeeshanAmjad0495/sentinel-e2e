#!/usr/bin/env node
// packages/cli/src/cli.ts
import { run } from "./dispatch";

/* istanbul ignore next -- thin process shim, exercised via dispatch.run */
async function main(): Promise<void> {
  const res = await run(process.argv.slice(2));
  process.stdout.write(res.output + "\n");
  process.exitCode = res.exitCode;
}

if (require.main === module) {
  void main();
}
