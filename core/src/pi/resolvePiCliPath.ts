import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function resolvePiCliPath(): string {
  const rpcEntryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  return join(dirname(rpcEntryPath), "cli.js");
}
