import { describe, expect, it } from "vitest";
import { ConfigValidator } from "../src/config/ConfigValidator.js";

describe("ConfigValidator", () => {
  it("reports valid config with provider, model, api key, and workspace", async () => {
    const validator = new ConfigValidator({
      exists: async () => true,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    await expect(
      validator.validate({ provider: "deepseek", model: "deepseek-reasoner", workspacePath: "/repo" })
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it("reports missing api key and workspace", async () => {
    const validator = new ConfigValidator({ exists: async () => false, env: {} });

    await expect(
      validator.validate({ provider: "deepseek", model: "deepseek-reasoner", workspacePath: "/missing" })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ severity: "error", code: "MISSING_API_KEY" }),
          { severity: "error", code: "WORKSPACE_NOT_FOUND", message: "Workspace does not exist: /missing" }
        ])
      })
    );
  });
});
