import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function resolveDefaultWorkspacePath(cwd: string = process.cwd()): Promise<string> {
  const start = resolve(cwd);
  const gitRoot = await findAncestorWith(start, ".git");
  return gitRoot ?? start;
}

async function findAncestorWith(start: string, marker: string): Promise<string | undefined> {
  let current = start;

  while (true) {
    if (await exists(resolve(current, marker))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
