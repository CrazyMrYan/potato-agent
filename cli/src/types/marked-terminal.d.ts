declare module "marked-terminal" {
  import type { MarkedExtension } from "marked";

  export type MarkedTerminalOptions = {
    reflowText?: boolean;
    width?: number;
    tab?: number;
    emoji?: boolean;
    color?: boolean;
    showSectionPrefix?: boolean;
    tableOptions?: unknown;
  };

  export function markedTerminal(options?: MarkedTerminalOptions): MarkedExtension;
}
