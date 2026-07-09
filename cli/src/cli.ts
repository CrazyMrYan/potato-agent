#!/usr/bin/env node
import { runDoctor } from "./commands/doctor.js";
import { loadPotatoConfig } from "./config/potatoConfig.js";
import { buildEnhancementReport, type PotatoEnhancementConfig } from "./enhancements/index.js";
import { launchPi } from "./pi/launchPi.js";

export type RunCliDependencies = {
  launchPi?: (args: string[], options?: { enhancements?: PotatoEnhancementConfig }) => Promise<void>;
  loadConfig?: () => Promise<PotatoEnhancementConfig>;
  runDoctor?: () => Promise<number>;
  write?: (line: string) => void;
};

export async function runCli(args: string[], dependencies: RunCliDependencies = {}): Promise<number> {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const [command, ...rest] = normalizedArgs;
  const write = dependencies.write ?? console.log;

  if (command === "doctor") {
    return dependencies.runDoctor ? dependencies.runDoctor() : runDoctor();
  }

  if (command === "enhancements") {
    const config = await (dependencies.loadConfig ?? loadPotatoConfig)();
    for (const item of buildEnhancementReport(config)) {
      write(`${item.enabled ? "ENABLED" : "DISABLED"} ${item.label} - ${item.detail}`);
    }
    return 0;
  }

  if (command === "version") {
    write("potato 0.1.0");
    return 0;
  }

  const delegate = dependencies.launchPi ?? launchPi;
  const config = await (dependencies.loadConfig ?? loadPotatoConfig)();
  await delegate(command === undefined ? [] : [command, ...rest], { enhancements: config });
  return 0;
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isDirectRun) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
