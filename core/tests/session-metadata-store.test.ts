import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionMetadataStore } from "../src/session/SessionMetadataStore.js";

describe("SessionMetadataStore", () => {
  it("saves and lists sessions from newest to oldest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "potato-session-"));
    const store = new SessionMetadataStore(workspace);

    await store.save({ sessionId: "old", provider: "deepseek", model: "deepseek-chat", workspacePath: workspace, updatedAt: "2026-07-07T00:00:00.000Z" });
    await store.save({ sessionId: "new", provider: "openai", model: "gpt-5", workspacePath: workspace, updatedAt: "2026-07-07T00:00:01.000Z" });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ sessionId: "new" }),
      expect.objectContaining({ sessionId: "old" })
    ]);
  });
});
