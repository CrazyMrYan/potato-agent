import { describe, expect, it } from "vitest";
import { formatCliError } from "../src/cliError.js";

describe("CLI error formatting", () => {
  it("prints a concise message without stack trace", () => {
    const message = formatCliError(new Error("缺少 OPENAI_API_KEY"));

    expect(message).toBe("任务启动失败：缺少 OPENAI_API_KEY");
    expect(message).not.toContain("Error:");
  });
});
