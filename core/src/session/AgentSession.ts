import type { AgentEvent } from "@coding-agent/protocol";
import type { PiSessionAdapter } from "../pi/PiSessionAdapter.js";

export class AgentSession {
  constructor(private readonly adapter: PiSessionAdapter) {}

  start(): Promise<void> {
    return this.adapter.start();
  }

  stop(): Promise<void> {
    return this.adapter.stop();
  }

  send(prompt: string): AsyncIterable<AgentEvent> {
    return this.adapter.send(prompt);
  }
}
