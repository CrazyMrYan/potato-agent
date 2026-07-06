import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentConfig } from "./AgentConfig.js";

export { mergeAgentConfig } from "./AgentConfig.js";

export interface AgentConfigStore {
  load(): Promise<AgentConfig>;
  save(config: AgentConfig): Promise<void>;
}

export class FileAgentConfigStore implements AgentConfigStore {
  private readonly configPath: string;

  constructor(private readonly workspacePath: string) {
    this.configPath = join(workspacePath, ".potato", "config.json");
  }

  async load(): Promise<AgentConfig> {
    try {
      return JSON.parse(await readFile(this.configPath, "utf8")) as AgentConfig;
    } catch (error) {
      if (isNotFound(error)) {
        return {};
      }

      throw error;
    }
  }

  async save(config: AgentConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

export async function ensureDefaultAgentConfig(store: AgentConfigStore): Promise<AgentConfig> {
  const config = await store.load();
  await store.save(config);
  return config;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
