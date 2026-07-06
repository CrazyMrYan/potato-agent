import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentConfig, AgentSkillConfig } from "../config/AgentConfig.js";
import { type AgentConfigStore, FileAgentConfigStore } from "../config/AgentConfigStore.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_BUILTIN_SKILLS: Required<Pick<AgentSkillConfig, "id" | "name" | "path" | "source" | "enabled">>[] = [
  builtin("skill-creator", false),
  builtin("skill-installer", false),
  builtin("superpowers", false),
  builtin("systematic-debugging", true),
  builtin("test-driven-development", false),
  builtin("verification-before-completion", true),
  builtin("requesting-code-review", false),
  builtin("receiving-code-review", false)
];

const BUILTIN_SKILL_DESCRIPTIONS: Record<string, string> = {
  "skill-creator": "Create or improve potato skills with a clear trigger, workflow, and verification notes.",
  "skill-installer": "Install external skills from trusted local paths or Git repositories and verify SKILL.md before enabling.",
  superpowers: "Use disciplined workflows such as planning, debugging, review, and verification when a task calls for them.",
  "systematic-debugging": "Find root cause before changing code. Reproduce the issue, inspect recent changes, form one hypothesis, then verify.",
  "test-driven-development": "Write a focused failing test before production code, implement the smallest fix, then keep the suite green.",
  "verification-before-completion": "Run the relevant checks and inspect results before claiming that work is complete.",
  "requesting-code-review": "Before integration, review the change for regressions, missing tests, and unclear behavior.",
  "receiving-code-review": "Evaluate review feedback technically, clarify ambiguous requests, and verify fixes before applying them."
};

export type SkillManagerDependencies = {
  clone?: (repoUrl: string, destination: string) => Promise<void>;
};

export class SkillManager {
  constructor(
    private readonly workspacePath: string,
    private readonly configStore: AgentConfigStore = new FileAgentConfigStore(workspacePath),
    private readonly dependencies: SkillManagerDependencies = {}
  ) {}

  async list(): Promise<AgentSkillConfig[]> {
    const config = await this.configStore.load();
    const configured = config.skills ?? [];
    const configuredById = new Map(configured.filter((skill) => skill.id).map((skill) => [skill.id as string, skill]));
    const builtins = await Promise.all(
      DEFAULT_BUILTIN_SKILLS.map(async (skill) => {
        const materialized = await this.materializeBuiltin(skill.id);
        const configuredSkill = configuredById.get(skill.id);
        return {
          ...skill,
          ...configuredSkill,
          id: skill.id,
          name: skill.name,
          path: materialized,
          source: "builtin" as const
        };
      })
    );
    const external = configured.filter((skill) => skill.source !== "builtin" && !DEFAULT_BUILTIN_SKILLS.some((builtinSkill) => builtinSkill.id === skill.id));
    return [...builtins, ...external];
  }

  async install(source: string): Promise<AgentSkillConfig> {
    const skill = isGitSource(source) ? await this.installGit(source) : await this.installLocal(source);
    await this.upsert(skill);
    return skill;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const skills = await this.list();
    const nextSkills = skills.map((skill) => (skill.id === id ? { ...skill, enabled } : skill));
    await this.saveSkills(nextSkills);
  }

  private async installLocal(path: string): Promise<AgentSkillConfig> {
    const resolved = resolve(path);
    await assertValidSkill(resolved);
    const name = await readSkillName(resolved);
    return {
      id: normalizeSkillId(name),
      name,
      path: resolved,
      source: "local",
      enabled: true
    };
  }

  private async installGit(repoUrl: string): Promise<AgentSkillConfig> {
    const id = normalizeSkillId(basename(repoUrl).replace(/\.git$/, ""));
    const destination = join(this.workspacePath, ".potato", "skills", id);
    await (this.dependencies.clone ?? cloneGit)(repoUrl, destination);
    await assertValidSkill(destination);
    const name = await readSkillName(destination);
    return {
      id: normalizeSkillId(name || id),
      name: name || id,
      path: destination,
      source: "git",
      enabled: true,
      repoUrl
    };
  }

  private async upsert(skill: AgentSkillConfig): Promise<void> {
    const skills = await this.list();
    const filtered = skills.filter((current) => current.id !== skill.id);
    await this.saveSkills([...filtered, skill]);
  }

  private async saveSkills(skills: AgentSkillConfig[]): Promise<void> {
    const config = await this.configStore.load();
    await this.configStore.save({ ...config, skills });
  }

  private async materializeBuiltin(id: string): Promise<string> {
    const destination = join(this.workspacePath, ".potato", "skills", ".builtin", id);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "SKILL.md"), builtinSkillContent(id), "utf8");
    return destination;
  }
}

function builtin(id: string, enabled: boolean): Required<Pick<AgentSkillConfig, "id" | "name" | "path" | "source" | "enabled">> {
  return {
    id,
    name: id,
    path: `builtin:${id}`,
    source: "builtin",
    enabled
  };
}

function builtinSkillContent(id: string): string {
  const description = BUILTIN_SKILL_DESCRIPTIONS[id] ?? `Built-in workflow skill: ${id}.`;
  return `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${id}\n\n${description}\n`;
}

async function assertValidSkill(path: string): Promise<void> {
  try {
    await stat(join(path, "SKILL.md"));
  } catch {
    throw new Error(`Skill path must contain SKILL.md: ${path}`);
  }
}

async function readSkillName(path: string): Promise<string> {
  const content = await readFile(join(path, "SKILL.md"), "utf8");
  const match = content.match(/^name:\s*["']?([^"'\n]+)["']?/m);
  return match?.[1]?.trim() || basename(path);
}

function isGitSource(source: string): boolean {
  return /^https?:\/\//.test(source) || /^git@/.test(source) || source.endsWith(".git");
}

function normalizeSkillId(value: string): string {
  return value
    .trim()
    .replace(/\.git$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function cloneGit(repoUrl: string, destination: string): Promise<void> {
  await mkdir(join(destination, ".."), { recursive: true });
  await execFileAsync("git", ["clone", "--depth", "1", repoUrl, destination]);
}
