import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openmaRoot } from "./storage-root";

const originalHooks = process.env["BACKCHAT_TEST_HOOKS"];
const originalTestHome = process.env["BACKCHAT_HOME"];

afterEach(() => {
  if (originalHooks === undefined) delete process.env["BACKCHAT_TEST_HOOKS"];
  else process.env["BACKCHAT_TEST_HOOKS"] = originalHooks;
  if (originalTestHome === undefined) delete process.env["BACKCHAT_HOME"];
  else process.env["BACKCHAT_HOME"] = originalTestHome;
});

describe("Backchat storage root", () => {
  it("uses only the OMA home for normal launches", () => {
    delete process.env["BACKCHAT_TEST_HOOKS"];
    delete process.env["BACKCHAT_HOME"];

    expect(openmaRoot()).toBe(join(homedir(), ".oma"));
  });

  it("uses an isolated root only when E2E test hooks explicitly provide one", () => {
    process.env["BACKCHAT_TEST_HOOKS"] = "1";
    process.env["BACKCHAT_HOME"] = "/tmp/backchat-isolated-home";

    expect(openmaRoot()).toBe("/tmp/backchat-isolated-home");
  });
});
