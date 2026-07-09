import { describe, expect, it, vi } from "vitest";
import { launchPi } from "../src/pi/launchPi.js";

describe("launchPi", () => {
  it("passes args and extension factories to Pi main", async () => {
    const main = vi.fn(async () => undefined);
    const extensionFactories = [() => undefined];

    await launchPi(["--print", "hello"], {
      main,
      extensionFactories
    });

    expect(main).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledWith(["--print", "hello"], { extensionFactories });
  });

  it("uses an empty extension factory list by default", async () => {
    const main = vi.fn(async () => undefined);

    await launchPi(["--help"], { main });

    expect(main).toHaveBeenCalledWith(["--help"], { extensionFactories: [] });
  });
});
