import { describe, expect, it, vi } from "vitest";
import { RuntimeSessionAdapter } from "../src/runtime/RuntimeSessionAdapter.js";

describe("RuntimeSessionAdapter", () => {
  it("runs through the AI SDK streamText seam and emits streaming agent events", async () => {
    const streamText = vi.fn(async () => ({
      stream: asyncIterable([
        { type: "reasoning-delta", delta: "runtime " },
        { type: "reasoning-delta", delta: "thinking" },
        { type: "text-delta", text: "runtime " },
        { type: "text-delta", text: "answer" }
      ])
    }));
    const adapter = new RuntimeSessionAdapter(
      {
        adapter: "runtime",
        provider: "openai-compatible",
        model: "test-model",
        apiKey: "test-key",
        workspacePath: "/repo",
        systemPrompt: "System",
        skills: [{ id: "debug", name: "debug", path: "/skills/debug", source: "local", enabled: true }]
      },
      {
        streamText,
        createModel: () => ({ provider: "test", modelId: "test-model", specificationVersion: "v4" }) as never
      }
    );

    const events = [];
    for await (const event of adapter.send("hello")) {
      events.push(event);
    }

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Potato managed skills:"),
        messages: [{ role: "user", content: "hello" }]
      })
    );
    expect(events).toEqual([
      expect.objectContaining({ type: "step.started", title: "Runtime adapter：openai-compatible/test-model" }),
      expect.objectContaining({ type: "assistant.delta", channel: "thinking", text: "runtime " }),
      expect.objectContaining({ type: "assistant.delta", channel: "thinking", text: "thinking" }),
      expect.objectContaining({ type: "assistant.delta", channel: "text", text: "runtime " }),
      expect.objectContaining({ type: "assistant.delta", channel: "text", text: "answer" }),
      expect.objectContaining({ type: "task.finished", summary: "runtime answer" })
    ]);
  });

  it("surfaces AI SDK failures as task.failed events", async () => {
    const adapter = new RuntimeSessionAdapter(
      { adapter: "runtime", provider: "openai-compatible", model: "test-model", apiKey: "test-key", workspacePath: "/repo" },
      {
        streamText: async () => {
          throw new Error("bad key");
        },
        createModel: () => ({ provider: "test", modelId: "test-model", specificationVersion: "v4" }) as never
      }
    );

    const events = [];
    for await (const event of adapter.send("hello")) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "task.failed", error: expect.objectContaining({ message: "bad key" }) }));
  });

  it("loads configured MCP tools into AI SDK streamText", async () => {
    const streamText = vi.fn(async () => ({ stream: asyncIterable([{ type: "text-delta", text: "used mcp" }]) }));
    const adapter = new RuntimeSessionAdapter(
      {
        provider: "openai-compatible",
        model: "test-model",
        apiKey: "test-key",
        workspacePath: "/repo",
        mcpServers: [{ name: "search", command: "npx", args: ["mcp-search"] }]
      },
      {
        streamText,
        createModel: () => ({ provider: "test", modelId: "test-model", specificationVersion: "v4" }) as never,
        mcp: {
          connect: async () => ({
            listTools: async () => ({
              tools: [{ name: "web_search", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }]
            }),
            callTool: async () => ({ content: [{ type: "text", text: "result" }] }),
            close: async () => {}
          })
        }
      }
    );

    for await (const _event of adapter.send("search")) {
      // consume
    }

    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ tools: expect.objectContaining({ search__web_search: expect.any(Object) }) }));
  });

  it("carries prior user and assistant messages into the next runtime turn", async () => {
    const streamText = vi
      .fn()
      .mockResolvedValueOnce({ stream: asyncIterable([{ type: "text-delta", text: "first answer" }]) })
      .mockResolvedValueOnce({ stream: asyncIterable([{ type: "text-delta", text: "continued answer" }]) });
    const adapter = new RuntimeSessionAdapter(
      {
        provider: "openai-compatible",
        model: "test-model",
        apiKey: "test-key",
        workspacePath: "/repo"
      },
      {
        streamText,
        createModel: () => ({ provider: "test", modelId: "test-model", specificationVersion: "v4" }) as never
      }
    );

    for await (const _event of adapter.send("这个项目怎么安装到全局")) {
      // consume
    }
    for await (const _event of adapter.send("继续啊")) {
      // consume
    }

    expect(streamText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: [
          { role: "user", content: "这个项目怎么安装到全局" },
          { role: "assistant", content: "first answer" },
          { role: "user", content: "继续啊" }
        ]
      })
    );
  });

  it("instructs the model not to emit DSML or XML pseudo tool calls", async () => {
    const streamText = vi.fn(async () => ({ stream: asyncIterable([{ type: "text-delta", text: "answer" }]) }));
    const adapter = new RuntimeSessionAdapter(
      {
        provider: "openai-compatible",
        model: "test-model",
        apiKey: "test-key",
        workspacePath: "/repo"
      },
      {
        streamText,
        createModel: () => ({ provider: "test", modelId: "test-model", specificationVersion: "v4" }) as never
      }
    );

    for await (const _event of adapter.send("install")) {
      // consume
    }

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Do not write DSML, XML, or pseudo tool call markup")
      })
    );
  });
});

async function* asyncIterable(items: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  for (const item of items) {
    yield item;
  }
}
