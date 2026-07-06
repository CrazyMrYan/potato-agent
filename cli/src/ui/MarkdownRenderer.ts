import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

export type MarkdownRendererOptions = {
  colors?: boolean;
};

export function renderMarkdownText(markdown: string, options: MarkdownRendererOptions = {}): string {
  const marked = new Marked(
    markedTerminal({
      reflowText: false,
      width: 100,
      showSectionPrefix: false,
      tab: 2,
      emoji: false,
      color: options.colors ?? false
    })
  );

  return marked.parse(markdown.trim(), { async: false }).trim();
}
