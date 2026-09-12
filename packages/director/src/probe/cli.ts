#!/usr/bin/env node
import { runProbe } from "./run.js";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--codex" || !args[1])) {
  console.error("Usage: node packages/director/dist/probe/cli.js [--codex /absolute/path/to/codex]");
  process.exitCode = 2;
} else {
  const report = await runProbe(args[1] ?? "codex");
  console.log(JSON.stringify(report, null, 2));
  if (!report.version || report.checks.some(check => check.status === "failed")) process.exitCode = 2;
}
