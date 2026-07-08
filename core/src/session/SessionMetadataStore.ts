import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SessionMetadata = {
  sessionId: string;
  provider?: string;
  model?: string;
  workspacePath: string;
  traceTaskId?: string;
  summary?: string;
  updatedAt: string;
};

export class SessionMetadataStore {
  private readonly sessionDir: string;

  constructor(private readonly workspacePath: string) {
    this.sessionDir = join(workspacePath, ".potato", "sessions");
  }

  async save(metadata: SessionMetadata): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    await writeFile(this.pathFor(metadata.sessionId), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }

  async list(): Promise<SessionMetadata[]> {
    let names: string[];
    try {
      names = await readdir(this.sessionDir);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const sessions = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(join(this.sessionDir, name), "utf8")) as SessionMetadata)
    );
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private pathFor(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.json`);
  }
}
