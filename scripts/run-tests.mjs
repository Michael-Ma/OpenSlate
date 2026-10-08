import { globSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  repositoryRoot,
  requireTestToolchain,
  testEnvironment,
  describeTestToolchain,
} from "./test-toolchain.mjs";
const report = requireTestToolchain();
console.log("Pinned test toolchain: " + describeTestToolchain(report));
const patterns = [
  "scripts/test/*.test.mjs",
  "packages/core/test/*.test.mjs",
  "packages/providers/test/*.test.mjs",
  "packages/director/test/*.test.mjs",
  "apps/server/test/*.test.mjs",
  "apps/web/test/*.test.mjs",
];
const requested = process.argv.slice(2),
  files = requested.length
    ? requested
    : patterns.flatMap((pattern) =>
        globSync(pattern, { cwd: repositoryRoot }).sort(),
      );
if (!files.length) throw new Error("No test files selected.");
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=4", ...files],
  {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: testEnvironment(report),
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
