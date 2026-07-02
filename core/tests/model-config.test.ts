import { describe, expect, it } from "vitest";
import { resolvePiAdapterOptions } from "../src/pi/resolvePiAdapterOptions.js";

describe("resolvePiAdapterOptions", () => {
  it("requires provider and model", () => {
    expect(() => resolvePiAdapterOptions({ workspacePath: "/repo", env: {} })).toThrow(/--provider/);
    expect(() => resolvePiAdapterOptions({ provider: "deepseek", workspacePath: "/repo", env: {} })).toThrow(/--model/);
  });

  it("uses provider-specific API key environment variables", () => {
    const options = resolvePiAdapterOptions({
      provider: "deepseek",
      model: "deepseek-chat",
      workspacePath: "/repo",
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    expect(options).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      workspacePath: "/repo",
      apiKeyEnvName: "DEEPSEEK_API_KEY",
      apiKey: "test-key"
    });
  });

  it("prefers runtime API key over environment variables", () => {
    const options = resolvePiAdapterOptions({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "runtime-key",
      workspacePath: "/repo",
      env: { GOOGLE_API_KEY: "env-key" }
    });

    expect(options.apiKeyEnvName).toBe("GOOGLE_API_KEY");
    expect(options.apiKey).toBe("runtime-key");
  });

  it("rejects unsupported providers", () => {
    expect(() =>
      resolvePiAdapterOptions({ provider: "unknown", model: "x", workspacePath: "/repo", env: {} })
    ).toThrow(/暂不支持 provider/);
  });
});
