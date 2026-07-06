export type PromptEditorState = {
  text: string;
  cursor: number;
};

export type PromptEditAction =
  | { type: "insert"; value: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "set"; value: string };

export type CompletionContext =
  | { type: "command"; query: string; start: number; end: number }
  | { type: "file"; query: string; start: number; end: number }
  | { type: "skill"; query: string; start: number; end: number };

export type CompletionSelection = {
  type: CompletionContext["type"];
  value: string;
};

export type PromptSegment = {
  kind: "text" | "file" | "skill";
  text: string;
};

export function createPromptEditor(text = "", cursor = text.length): PromptEditorState {
  return { text, cursor: clamp(cursor, 0, text.length) };
}

export function editPrompt(editor: PromptEditorState, action: PromptEditAction): PromptEditorState {
  switch (action.type) {
    case "insert":
      return {
        text: `${editor.text.slice(0, editor.cursor)}${action.value}${editor.text.slice(editor.cursor)}`,
        cursor: editor.cursor + action.value.length
      };
    case "backspace":
      if (editor.cursor === 0) return editor;
      return {
        text: `${editor.text.slice(0, editor.cursor - 1)}${editor.text.slice(editor.cursor)}`,
        cursor: editor.cursor - 1
      };
    case "delete":
      if (editor.cursor >= editor.text.length) return editor;
      return {
        text: `${editor.text.slice(0, editor.cursor)}${editor.text.slice(editor.cursor + 1)}`,
        cursor: editor.cursor
      };
    case "left":
      return { ...editor, cursor: Math.max(0, editor.cursor - 1) };
    case "right":
      return { ...editor, cursor: Math.min(editor.text.length, editor.cursor + 1) };
    case "home":
      return { ...editor, cursor: 0 };
    case "end":
      return { ...editor, cursor: editor.text.length };
    case "set":
      return createPromptEditor(action.value);
  }
}

export function detectCompletion(editor: PromptEditorState): CompletionContext | undefined {
  const left = editor.text.slice(0, editor.cursor);
  const match = /(^|\s)([/@$])([^\s]*)$/.exec(left);
  if (!match) {
    return undefined;
  }

  const trigger = match[2];
  const query = match[3] ?? "";
  const start = left.length - trigger.length - query.length;
  if (trigger === "/") return { type: "command", query, start, end: editor.cursor };
  if (trigger === "@") return { type: "file", query, start, end: editor.cursor };
  return { type: "skill", query, start, end: editor.cursor };
}

export function applyCompletion(editor: PromptEditorState, selection: CompletionSelection): PromptEditorState {
  const context = detectCompletion(editor);
  if (!context || context.type !== selection.type) {
    return editor;
  }

  const prefix = selection.type === "command" ? "" : selection.type === "file" ? "@" : "$";
  const suffix = selection.type === "command" ? "" : " ";
  const replacement = `${prefix}${selection.value}${suffix}`;
  const text = `${editor.text.slice(0, context.start)}${replacement}${editor.text.slice(context.end)}`;
  return { text, cursor: context.start + replacement.length };
}

export function extractSkillMentions(text: string): string[] {
  return [...new Set([...text.matchAll(/(^|\s)\$([A-Za-z0-9._:-]+)/g)].map((match) => match[2]))];
}

export function renderPromptSegments(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const tokenPattern = /(@[^\s]+|\$[A-Za-z0-9._:-]+)/g;
  let index = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index ?? 0;
    if (start > index) {
      segments.push({ kind: "text", text: text.slice(index, start) });
    }
    const token = match[0];
    segments.push({ kind: token.startsWith("@") ? "file" : "skill", text: token });
    index = start + token.length;
  }
  if (index < text.length) {
    segments.push({ kind: "text", text: text.slice(index) });
  }
  return segments.length > 0 ? segments : [{ kind: "text", text }];
}

export function renderPromptWithCursor(editor: PromptEditorState): PromptSegment[] {
  const text = `${editor.text.slice(0, editor.cursor)}▌${editor.text.slice(editor.cursor)}`;
  return renderPromptSegments(text);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
