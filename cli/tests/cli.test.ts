import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import type { PotatoEnhancementConfig } from "../src/enhancements/index.js";

describe("runCli", () => {
  it("delegates unknown and Pi-owned args to Pi unchanged", async () => {
    const launchPi = vi.fn(async () => undefined);

    await runCli(["--print", "hello", "--future-pi-flag"], {
      launchPi,
      loadConfig: async () => ({ approval: true }),
      runDoctor: async () => 0,
      write: () => undefined
    });

    expect(launchPi).toHaveBeenCalledWith(["--print", "hello", "--future-pi-flag"], { enhancements: { approval: true } });
  });

  it("runs potato doctor without launching Pi", async () => {
    const launchPi = vi.fn(async () => undefined);
    const runDoctor = vi.fn(async () => 0);

    await runCli(["doctor"], {
      launchPi,
      runDoctor,
      write: () => undefined
    });

    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(launchPi).not.toHaveBeenCalled();
  });

  it("ignores a leading package-manager argument separator", async () => {
    const launchPi = vi.fn(async () => undefined);
    const runDoctor = vi.fn(async () => 0);

    await runCli(["--", "doctor"], {
      launchPi,
      runDoctor,
      write: () => undefined
    });

    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(launchPi).not.toHaveBeenCalled();
  });

  it("prints enhancement status without launching Pi", async () => {
    const lines: string[] = [];
    const launchPi = vi.fn(async () => undefined);

    await runCli(["enhancements"], {
      launchPi,
      runDoctor: async () => 0,
      loadConfig: async () => ({
        approval: true,
        mcpServers: [{ name: "docs", command: "npx" }],
        subagents: [{ id: "reviewer", description: "Review code", systemPrompt: "You review code." }]
      }),
      write: (line) => lines.push(line)
    });

    expect(lines).toEqual([
      "ENABLED Write/command approval - enabled by default",
      "ENABLED MCP bridge - 1 server(s) configured",
      "ENABLED Potato subagents - 1 subagent(s) configured"
    ]);
    expect(launchPi).not.toHaveBeenCalled();
  });

  it("loads Potato enhancement config before launching Pi", async () => {
    const config: PotatoEnhancementConfig = {
      approval: true,
      mcpServers: [{ name: "docs", command: "npx" }]
    };
    const launchPi = vi.fn(async () => undefined);

    await runCli(["--print", "hello"], {
      launchPi,
      loadConfig: async () => config,
      runDoctor: async () => 0,
      write: () => undefined
    });

    expect(launchPi).toHaveBeenCalledWith(["--print", "hello"], { enhancements: config });
  });
});
