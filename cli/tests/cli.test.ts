import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

describe("runCli", () => {
  it("delegates unknown and Pi-owned args to Pi unchanged", async () => {
    const launchPi = vi.fn(async () => undefined);

    await runCli(["--print", "hello", "--future-pi-flag"], {
      launchPi,
      runDoctor: async () => 0,
      write: () => undefined
    });

    expect(launchPi).toHaveBeenCalledWith(["--print", "hello", "--future-pi-flag"]);
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

  it("prints enhancement status without launching Pi", async () => {
    const lines: string[] = [];
    const launchPi = vi.fn(async () => undefined);

    await runCli(["enhancements"], {
      launchPi,
      runDoctor: async () => 0,
      write: (line) => lines.push(line)
    });

    expect(lines).toEqual(["No Potato enhancements are enabled."]);
    expect(launchPi).not.toHaveBeenCalled();
  });
});
