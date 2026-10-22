import { describe, expect, it } from "vitest";
import { environmentErrorKind } from "./environment-error";

/** Errors caused by the machine, not the turn: retrying will fail the same way
 *  until the user fixes the environment, so they belong above the composer. */
describe("environmentErrorKind", () => {
  it("recognises a full disk", () => {
    expect(
      environmentErrorKind(
        "Error invoking remote method 'session:prompt': Error: ENOSPC: no space left on device, open '/x'",
      ),
    ).toBe("diskFull");
    expect(environmentErrorKind("Internal error: ENOSPC: no space left on device, write")).toBe("diskFull");
  });

  it("ignores ordinary turn failures", () => {
    expect(environmentErrorKind("ACP connection closed")).toBeNull();
    expect(environmentErrorKind(undefined)).toBeNull();
  });
});
