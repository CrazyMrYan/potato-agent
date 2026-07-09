#!/usr/bin/env node
import { runDoctor } from "./commands/doctor.js";
import { launchPi } from "./pi/launchPi.js";

export type RunCliDependencies = {
  launchPi?: (args: string[]) => Promise<void>;
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
    write("No Potato enhancements are enabled.");
    return 0;
  }

  if (command === "version") {
    write("potato 0.1.0");
    return 0;
  }

  const delegate = dependencies.launchPi ?? launchPi;
  await delegate(command === undefined ? [] : [command, ...rest]);
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
