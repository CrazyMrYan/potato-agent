import { describe, expect, it } from "vitest";
import {
  applyCompletion,
  createPromptEditor,
  detectCompletion,
  editPrompt,
  extractSkillMentions,
  renderPromptSegments
} from "../src/ui/PromptEditor.js";

describe("PromptEditor", () => {
  it("edits text at the cursor instead of always appending", () => {
    let editor = createPromptEditor("ac", 1);

    editor = editPrompt(editor, { type: "insert", value: "b" });
    expect(editor).toEqual({ text: "abc", cursor: 2 });

    editor = editPrompt(editor, { type: "backspace" });
    expect(editor).toEqual({ text: "ac", cursor: 1 });

    editor = editPrompt(editor, { type: "end" });
    editor = editPrompt(editor, { type: "delete" });
    expect(editor).toEqual({ text: "ac", cursor: 2 });
  });

  it("detects slash, file, and skill completions at the cursor", () => {
    expect(detectCompletion(createPromptEditor("/wo", 3))).toEqual({ type: "command", query: "wo", start: 0, end: 3 });
    expect(detectCompletion(createPromptEditor("read @cli/s", 11))).toEqual({ type: "file", query: "cli/s", start: 5, end: 11 });
    expect(detectCompletion(createPromptEditor("use $debug", 10))).toEqual({ type: "skill", query: "debug", start: 4, end: 10 });
  });

  it("applies completions and keeps a trailing space", () => {
    expect(applyCompletion(createPromptEditor("read @cli/s", 11), { type: "file", value: "cli/src/ui/AgentTui.tsx" })).toEqual({
      text: "read @cli/src/ui/AgentTui.tsx ",
      cursor: 30
    });
    expect(applyCompletion(createPromptEditor("/wo", 3), { type: "command", value: "/workspace" })).toEqual({
      text: "/workspace",
      cursor: 10
    });
  });

  it("extracts skill mentions and marks file and skill tokens for rendering", () => {
    expect(extractSkillMentions("review @src/a.ts with $code-reviewer and $systematic-debugging")).toEqual(["code-reviewer", "systematic-debugging"]);
    expect(renderPromptSegments("review @src/a.ts with $systematic-debugging").map((segment) => segment.kind)).toEqual(["text", "file", "text", "skill"]);
  });
});
