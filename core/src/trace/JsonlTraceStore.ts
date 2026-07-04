import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TraceEntry, TraceStore, TraceSummary } from "./TraceStore.js";

export class JsonlTraceStore implements TraceStore {
  private readonly traceDir: string;

  constructor(private readonly workspacePath: string) {
    this.traceDir = join(workspacePath, ".coding-agent", "traces");
  }

  async append(entry: TraceEntry): Promise<void> {
    const filePath = this.pathFor(entry.taskId);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async read(taskId: string): Promise<TraceEntry[]> {
    const content = await readFile(this.pathFor(taskId), "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TraceEntry);
  }

  async list(): Promise<TraceSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.traceDir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl"))
        .map(async (name): Promise<TraceSummary> => {
          const path = join(this.traceDir, name);
          const content = await readFile(path, "utf8");
          const entries = content.split("\n").filter((line) => line.trim().length > 0);
          const fileStat = await stat(path);
          return {
            taskId: name.slice(0, -".jsonl".length),
            path,
            updatedAt: fileStat.mtime.toISOString(),
            entries: entries.length
          };
        })
    );

    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private pathFor(taskId: string): string {
    return join(this.traceDir, `${taskId}.jsonl`);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
