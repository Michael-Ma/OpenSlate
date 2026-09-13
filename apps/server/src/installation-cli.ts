import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DomainError, invariant } from "@openslate/core";
import { createInstallationBackup, inspectInstallationBackup } from "./persistence/installation-backup.js";
import { restoreInstallationBackup } from "./persistence/installation-restore.js";

export async function installationCommand(args: string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
  const [command, ...remaining] = args, values = new Map<string, string>();
  invariant(command && ["export", "inspect", "restore"].includes(command), "INSTALLATION_USAGE", "Use export --data-dir PATH --output PATH, inspect --backup PATH, or restore --backup PATH --data-dir PATH");
  for (let index = 0; index < remaining.length; index += 2) {
    const name = remaining[index], value = remaining[index + 1];
    invariant(name && value && ["--data-dir", "--output", "--backup"].includes(name) && !value.startsWith("--") && !values.has(name), "INSTALLATION_USAGE", "Use each required path option exactly once"); values.set(name, resolve(value));
  }
  const expected = command === "export" ? ["--data-dir", "--output"] : command === "inspect" ? ["--backup"] : ["--backup", "--data-dir"];
  invariant(values.size === expected.length && expected.every(name => values.has(name)), "INSTALLATION_USAGE", "Unexpected or missing installation path option");
  const context = signal ? { signal } : {};
  if (command === "restore") {
    const result = await restoreInstallationBackup({ directory: values.get("--backup")!, destination: values.get("--data-dir")!, ...context });
    return { operation: command, status: result.status, directory: result.directory, restoreId: result.receipt.restoreId, backupId: result.receipt.backupId,
      projects: result.receipt.projectIds.length, recovery: "Review the restored installation in OpenSlate. Existing projects remain paused; saved authority cannot start new work." };
  }
  const result = command === "export"
    ? await createInstallationBackup({ sourceRoot: values.get("--data-dir")!, destination: values.get("--output")!, ...context })
    : await inspectInstallationBackup({ directory: values.get("--backup")!, ...context });
  return { operation: command, status: command === "export" ? "exported" : "verified", directory: result.directory, backupId: result.manifest.backupId,
    originalDataRoot: result.manifest.originalDataRoot, createdAt: result.manifest.createdAt, applicationSchemaVersion: result.manifest.applicationSchemaVersion,
    files: result.manifest.files.length, byteLength: result.manifest.files.reduce((sum, file) => sum + file.byteLength, 0), manifestSha256: result.manifestSha256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController(), abort = () => controller.abort(); process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try { process.stdout.write(`${JSON.stringify(await installationCommand(process.argv.slice(2), controller.signal))}\n`); }
  catch (error) { process.stderr.write(`${JSON.stringify({ error: { code: error instanceof DomainError ? error.code : "INSTALLATION_OPERATION_FAILED",
    message: error instanceof DomainError ? error.message : "Installation operation failed. No application workers were started." } })}\n`); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}
