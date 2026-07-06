import { describe, expect, it } from "vitest";
import { renderChangeSetLines } from "../src/ui/DiffRenderer.js";

describe("DiffRenderer", () => {
  it("groups files and renders diff prefixes consistently", () => {
    expect(
      renderChangeSetLines({
        files: [
          {
            path: "src/a.ts",
            status: "modified",
            diff: "@@ -1 +1 @@\n-old\n+new"
          }
        ]
      })
    ).toEqual(["diff: 1 file changed", "modified src/a.ts", "  @@ -1 +1 @@", "- old", "+ new"]);
  });
});
