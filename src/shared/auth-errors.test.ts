import { describe, expect, it } from "vitest";

import {
  isAuthenticationFailureMessage,
  sanitizeAuthenticationMessage,
} from "./auth-errors.js";

describe("isAuthenticationFailureMessage", () => {
  it("matches ACP Authentication required", () => {
    expect(isAuthenticationFailureMessage("Authentication required")).toBe(true);
  });

  it("matches wrapped invalid-key turn failures", () => {
    expect(
      isAuthenticationFailureMessage(
        "Internal error: turn failed: Authentication Fails, Your api key: fadf is invalid",
      ),
    ).toBe(true);
  });

  it("does not match ordinary turn failures", () => {
    expect(isAuthenticationFailureMessage("Internal error: turn failed: model overloaded")).toBe(false);
    expect(isAuthenticationFailureMessage(undefined)).toBe(false);
  });
});

describe("sanitizeAuthenticationMessage", () => {
  it("redacts leaked API keys without dropping the failure reason", () => {
    expect(
      sanitizeAuthenticationMessage(
        "Internal error: turn failed: Authentication Fails, Your api key: fadf is invalid",
      ),
    ).toBe(
      "Internal error: turn failed: Authentication Fails, Your api key=[redacted] is invalid",
    );
  });
});
