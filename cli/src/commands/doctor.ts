import { main } from "@earendil-works/pi-coding-agent";

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
    }
  ];
}
