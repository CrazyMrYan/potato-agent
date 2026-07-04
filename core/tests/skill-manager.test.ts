import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BUILTIN_SKILLS, SkillManager } from "../src/skills/SkillManager.js";
import type { AgentConfigStore } from "../src/config/AgentConfigStore.js";
import type { AgentConfig } from "../src/config/AgentConfig.js";

describe("SkillManager", () => {
  it("lists built-in skills with conservative defaults", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-skills-"));
    try {
      const manager = new SkillManager(workspace, new MemoryConfigStore({}));
      const skills = await manager.list();

      expect(skills.map((skill) => skill.id)).toContain("systematic-debugging");
      expect(skills.map((skill) => skill.id)).toContain("skill-creator");
      expect(skills.find((skill) => skill.id === "systematic-debugging")?.enabled).toBe(true);
      expect(skills.find((skill) => skill.id === "verification-before-completion")?.enabled).toBe(true);
      expect(skills.find((skill) => skill.id === "skill-creator")?.enabled).toBe(false);
      expect(skills.find((skill) => skill.id === "systematic-debugging")?.path).toMatch(/systematic-debugging$/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("materializes built-in skills as readable SKILL.md directories", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-builtin-skill-"));
    try {
      const manager = new SkillManager(workspace, new MemoryConfigStore({}));
      const skills = await manager.list();
      const skill = skills.find((item) => item.id === "systematic-debugging");

      expect(skill?.source).toBe("builtin");
      expect(skill?.path).not.toMatch(/^builtin:/);
      await expect(readFile(join(skill?.path ?? "", "SKILL.md"), "utf8")).resolves.toContain("name: systematic-debugging");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("repairs older builtin placeholder paths when listing skills", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-repair-builtin-skill-"));
    try {
      const manager = new SkillManager(
        workspace,
        new MemoryConfigStore({
          skills: [{ id: "systematic-debugging", name: "systematic-debugging", path: "builtin:systematic-debugging", source: "builtin", enabled: false }]
        })
      );
      const skills = await manager.list();
      const skill = skills.find((item) => item.id === "systematic-debugging");

      expect(skill?.enabled).toBe(false);
      expect(skill?.path).toBe(join(workspace, ".coding-agent", "builtin-skills", "systematic-debugging"));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("installs a local skill after validating SKILL.md", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-local-skill-"));
    const localSkill = await mkdtemp(join(tmpdir(), "external-skill-"));
    const store = new MemoryConfigStore({});
    try {
      await writeFile(join(localSkill, "SKILL.md"), "---\nname: review\n---\n# Review\n", "utf8");

      const installed = await new SkillManager(workspace, store).install(localSkill);

      expect(installed).toMatchObject({ id: "review", name: "review", path: localSkill, source: "local", enabled: true });
      expect(store.saved?.skills).toContainEqual(expect.objectContaining({ id: "review", source: "local", enabled: true }));
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(localSkill, { recursive: true, force: true });
    }
  });

  it("installs a git skill into the workspace skills directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-git-skill-"));
    const store = new MemoryConfigStore({});
    const clone = vi.fn(async (_repoUrl: string, destination: string) => {
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "SKILL.md"), "---\nname: remote-review\n---\n# Remote Review\n", "utf8");
    });
    try {
      const installed = await new SkillManager(workspace, store, { clone }).install("https://example.com/remote-review.git");

      expect(installed).toMatchObject({
        id: "remote-review",
        name: "remote-review",
        source: "git",
        repoUrl: "https://example.com/remote-review.git",
        enabled: true
      });
      expect(installed.path).toBe(join(workspace, ".coding-agent", "skills", "remote-review"));
      expect(clone).toHaveBeenCalledWith("https://example.com/remote-review.git", installed.path);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("toggles enabled state without deleting the skill", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-toggle-skill-"));
    const store = new MemoryConfigStore({
      skills: [{ id: "review", name: "review", path: "/skills/review", source: "local", enabled: true }]
    });
    try {
      await new SkillManager(workspace, store).setEnabled("review", false);

      expect(store.saved?.skills).toContainEqual({ id: "review", name: "review", path: "/skills/review", source: "local", enabled: false });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects invalid local skills without SKILL.md", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-invalid-skill-"));
    const localSkill = await mkdtemp(join(tmpdir(), "invalid-skill-"));
    try {
      await expect(new SkillManager(workspace, new MemoryConfigStore({})).install(localSkill)).rejects.toThrow(/SKILL.md/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(localSkill, { recursive: true, force: true });
    }
  });

  it("defines the expected built-in skill ids", () => {
    expect(DEFAULT_BUILTIN_SKILLS.map((skill) => skill.id)).toEqual([
      "skill-creator",
      "skill-installer",
      "superpowers",
      "systematic-debugging",
      "test-driven-development",
      "verification-before-completion",
      "requesting-code-review",
      "receiving-code-review"
    ]);
  });
});

class MemoryConfigStore implements AgentConfigStore {
  saved?: AgentConfig;

  constructor(private config: AgentConfig) {}

  async load(): Promise<AgentConfig> {
    return this.config;
  }

  async save(config: AgentConfig): Promise<void> {
    this.saved = config;
    this.config = config;
  }
}
