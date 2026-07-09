import { main } from "@earendil-works/pi-coding-agent";
import { buildEnhancementReport, createPotatoExtensionFactories } from "../enhancements/index.js";

export type DoctorResult = {
  ok: boolean;
  message: string;
};

export type DoctorCheck = {
  name: string;
  run(): Promise<DoctorResult>;
};

export type DoctorOptions = {
  checks?: DoctorCheck[];
  write?: (line: string) => void;
};

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const checks = options.checks ?? defaultDoctorChecks();
  const write = options.write ?? console.log;
  let ok = true;

  for (const check of checks) {
    const result = await check.run();
    ok &&= result.ok;
    write(`${result.ok ? "OK" : "FAIL"} ${check.name} - ${result.message}`);
  }

  return ok ? 0 : 1;
}

export function defaultDoctorChecks(): DoctorCheck[] {
  return [
    {
      name: "node",
      async run() {
        const major = Number.parseInt(process.versions.node.split(".", 1)[0] ?? "0", 10);
        return major >= 22
          ? { ok: true, message: `Node ${process.versions.node}` }
          : { ok: false, message: `Node ${process.versions.node}; Pi requires Node >=22.19.0` };
      }
    },
    {
      name: "pi-main",
      async run() {
        return typeof main === "function"
          ? { ok: true, message: "@earendil-works/pi-coding-agent main export available" }
          : { ok: false, message: "@earendil-works/pi-coding-agent main export missing" };
      }
    },
    {
      name: "potato-extensions",
      async run() {
        return createPotatoExtensionFactories({ approval: true }).length > 0
          ? { ok: true, message: "Potato extension factories are available" }
          : { ok: false, message: "Potato extension factories are missing" };
      }
    },
    {
      name: "potato-approval",
      async run() {
        const approval = buildEnhancementReport({ approval: true }).find((item) => item.id === "approval");
        return approval?.enabled
          ? { ok: true, message: "write/command approval is enabled by default" }
          : { ok: false, message: "write/command approval is not enabled by default" };
      }
    }
  ];
}
