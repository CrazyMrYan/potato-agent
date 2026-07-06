export function renderMarkdownText(markdown: string): string {
  const lines = markdown.trim().split("\n");
  const rendered: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      rendered.push(line);
      continue;
    }

    rendered.push(renderMarkdownLine(line));
  }

  return trimBlankEdges(rendered).join("\n");
}

function renderMarkdownLine(line: string): string {
  const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
  if (heading) {
    return stripInlineMarkdown(heading[1] ?? "");
  }

  const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
  if (bullet) {
    return `${bullet[1]}• ${stripInlineMarkdown(bullet[2] ?? "")}`;
  }

  const quote = line.match(/^\s*>\s?(.+)$/);
  if (quote) {
    return `│ ${stripInlineMarkdown(quote[1] ?? "")}`;
  }

  return stripInlineMarkdown(line);
}

function stripInlineMarkdown(value: string): string {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

function trimBlankEdges(lines: string[]): string[] {
  const next = [...lines];
  while (next[0]?.trim() === "") {
    next.shift();
  }
  while (next.at(-1)?.trim() === "") {
    next.pop();
  }
  return next;
}
