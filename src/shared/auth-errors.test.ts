import { describe, expect, it } from "vitest";

import {
  isAuthenticationFailureMessage,
  isAuthenticationRequiredError,
  sessionErrorDetails,
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

describe("structured authentication errors", () => {
  it("uses the standard ACP error code for any harness", () => {
    expect(isAuthenticationRequiredError({ code: -32000 }, "other-agent")).toBe(true);
  });

  it.each([
    "unauthorized",
    { httpConnectionFailed: { httpStatusCode: 401 } },
    { responseStreamConnectionFailed: { httpStatusCode: 401 } },
    { responseStreamDisconnected: { httpStatusCode: 401 } },
    { responseTooManyFailedAttempts: { httpStatusCode: 401 } },
  ])("recognizes legacy Codex auth evidence %j", (codexErrorInfo) => {
    const error = { code: -32603, data: { codexErrorInfo } };
    expect(isAuthenticationRequiredError(error, "codex-acp")).toBe(true);
    expect(isAuthenticationRequiredError(error, "other-agent")).toBe(false);
  });

  it.each([
    undefined,
    "usageLimitExceeded",
    { httpConnectionFailed: { httpStatusCode: 403 } },
    { httpConnectionFailed: { httpStatusCode: 500 } },
    { unrelated: { httpStatusCode: 401 } },
  ])("does not turn unrelated internal errors into auth prompts: %j", (codexErrorInfo) => {
    expect(isAuthenticationRequiredError({ code: -32603, data: { codexErrorInfo } }, "codex-acp")).toBe(false);
  });

  it("retains protocol evidence while redacting secrets before transport or persistence", () => {
    expect(sessionErrorDetails({
      code: -32603,
      message: "Internal error",
      data: {
        codexErrorInfo: "unauthorized",
        message: "Invalid token=private-value",
        refresh_token: "private-refresh",
        nested: { Authorization: "Basic private-header", apiKey: "private-key" },
      },
    })).toEqual({
      code: -32603,
      message: "Internal error",
      data: {
        codexErrorInfo: "unauthorized",
        message: "Invalid token=[redacted]",
        refresh_token: "[redacted]",
        nested: { Authorization: "[redacted]", apiKey: "[redacted]" },
      },
    });
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
