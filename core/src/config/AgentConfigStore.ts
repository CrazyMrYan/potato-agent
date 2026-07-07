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
    const config = await this.loadConfigFile();
    const projectInstructions = await this.loadProjectInstructions();
    return projectInstructions ? { ...config, projectInstructions } : config;
  }

  private async loadConfigFile(): Promise<AgentConfig> {
    try {
      return toUserConfig(JSON.parse(await readFile(this.configPath, "utf8")) as AgentConfig);
    } catch (error) {
      if (isNotFound(error)) {
        return {};
      }

      throw error;
    }
  }

  private async loadProjectInstructions(): Promise<string | undefined> {
    try {
      const content = (await readFile(join(this.workspacePath, "POTATO.md"), "utf8")).trim();
      return content || undefined;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async save(config: AgentConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(toPersistedConfig(config), null, 2)}\n`, "utf8");
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

function toPersistedConfig(config: AgentConfig): AgentConfig {
  return toUserConfig(config);
}

function toUserConfig(config: AgentConfig): AgentConfig {
  const { projectInstructions: _projectInstructions, systemPrompt: _systemPrompt, ...persisted } = config as AgentConfig & { systemPrompt?: string };
  return persisted;
}
