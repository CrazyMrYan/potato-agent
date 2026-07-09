import { describe, expect, it } from "vitest";
import { defaultDoctorChecks, runDoctor, type DoctorCheck } from "../src/commands/doctor.js";

describe("runDoctor", () => {
  it("reports all checks as ok when Pi exports are available", async () => {
    const checks: DoctorCheck[] = [
      { name: "node", run: async () => ({ ok: true, message: "Node OK" }) },
      { name: "pi-main", run: async () => ({ ok: true, message: "Pi main OK" }) }
    ];
    const lines: string[] = [];

    const exitCode = await runDoctor({ checks, write: (line) => lines.push(line) });

    expect(exitCode).toBe(0);
    expect(lines).toEqual(["OK node - Node OK", "OK pi-main - Pi main OK"]);
  });

  it("returns non-zero when any check fails", async () => {
    const checks: DoctorCheck[] = [
      { name: "pi-main", run: async () => ({ ok: false, message: "Missing Pi main export" }) }
    ];
    const lines: string[] = [];

    const exitCode = await runDoctor({ checks, write: (line) => lines.push(line) });

    expect(exitCode).toBe(1);
    expect(lines).toEqual(["FAIL pi-main - Missing Pi main export"]);
  });

  it("includes Potato enhancement integration checks by default", () => {
    expect(defaultDoctorChecks().map((check) => check.name)).toEqual(
      expect.arrayContaining(["potato-extensions", "potato-approval"])
    );
  });
});
