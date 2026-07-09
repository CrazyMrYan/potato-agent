import { main as piMain, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createPotatoExtensionFactories, type PotatoEnhancementConfig } from "../enhancements/index.js";

export type PiMain = (args: string[], options?: { extensionFactories?: ExtensionFactory[] }) => Promise<void>;

export type LaunchPiOptions = {
  main?: PiMain;
  extensionFactories?: ExtensionFactory[];
  enhancements?: PotatoEnhancementConfig;
};

export async function launchPi(args: string[], options: LaunchPiOptions = {}): Promise<void> {
  const main = options.main ?? piMain;
  await main(args, {
    extensionFactories: options.extensionFactories ?? defaultExtensionFactories(args, options.enhancements)
  });
}

function defaultExtensionFactories(args: string[], enhancements: PotatoEnhancementConfig | undefined): ExtensionFactory[] {
  if (args.includes("--no-extensions") || args.includes("-ne")) return [];
  return createPotatoExtensionFactories(enhancements);
}
