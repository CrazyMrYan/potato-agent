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

  it("uses Potato enhancement extension factories by default", async () => {
    const main = vi.fn(async () => undefined);

    await launchPi(["--help"], { main });

    expect(main.mock.calls[0]?.[1]?.extensionFactories?.length).toBeGreaterThan(0);
  });

  it("does not inject Potato enhancement factories when Pi extensions are disabled", async () => {
    const main = vi.fn(async () => undefined);

    await launchPi(["--no-extensions", "--print", "hello"], { main });

    expect(main).toHaveBeenCalledWith(["--no-extensions", "--print", "hello"], { extensionFactories: [] });
  });

  it("honors an explicit extension factory override even when Pi extension discovery is disabled", async () => {
    const main = vi.fn(async () => undefined);
    const extensionFactories = [() => undefined];

    await launchPi(["-ne", "--print", "hello"], { main, extensionFactories });

    expect(main).toHaveBeenCalledWith(["-ne", "--print", "hello"], { extensionFactories });
  });
});
