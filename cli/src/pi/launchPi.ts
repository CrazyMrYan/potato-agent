import { main as piMain, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type PiMain = (args: string[], options?: { extensionFactories?: ExtensionFactory[] }) => Promise<void>;

export type LaunchPiOptions = {
  main?: PiMain;
  extensionFactories?: ExtensionFactory[];
};

export async function launchPi(args: string[], options: LaunchPiOptions = {}): Promise<void> {
  const main = options.main ?? piMain;
  await main(args, {
    extensionFactories: options.extensionFactories ?? []
  });
}
