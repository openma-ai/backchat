import { describe, expect, it } from "vitest";

import {
  inspectCodexProviderError,
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

  it("matches provider wording for missing credentials", () => {
    expect(
      isAuthenticationFailureMessage(
        "auth_unavailable: no auth available (providers=devin, model=devin/gpt-6-1-sol)",
      ),
    ).toBe(true);
    expect(isAuthenticationFailureMessage("no auth available")).toBe(true);
    expect(isAuthenticationFailureMessage("Unauthorized")).toBe(true);
  });

  it("does not match ordinary turn failures", () => {
    expect(isAuthenticationFailureMessage("Internal error: turn failed: model overloaded")).toBe(false);
    expect(isAuthenticationFailureMessage(undefined)).toBe(false);
  });
});

describe("inspectCodexProviderError", () => {
  it("keeps a soft reconnect retryable when there is no terminal evidence", () => {
    const evidence = inspectCodexProviderError({
      message: "Reconnecting... 1/5",
      willRetry: true,
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
    });
    expect(evidence.terminal).toBe(false);
    expect(evidence.authUnavailable).toBe(false);
    expect(evidence.quotaUnavailable).toBe(false);
    expect(evidence.message).toBe("Reconnecting... 1/5");
  });

  it("treats auth_unavailable in additionalDetails as terminal", () => {
    const evidence = inspectCodexProviderError({
      message: "Reconnecting... 2/5",
      willRetry: true,
      additionalDetails:
        "auth_unavailable: no auth available (providers=devin, model=devin/gpt-6-1-sol); devin upstream error (invalid_argument)",
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 503 } },
    });
    expect(evidence.terminal).toBe(true);
    expect(evidence.authUnavailable).toBe(true);
    expect(evidence.quotaUnavailable).toBe(false);
    expect(evidence.message).toContain("auth_unavailable");
  });

  it("treats exhausted quota as terminal without calling it an auth failure", () => {
    const evidence = inspectCodexProviderError({
      message: "Reconnecting... 1/5",
      willRetry: true,
      additionalDetails: "usageLimitExceeded: You have reached your usage limit",
    });
    expect(evidence.terminal).toBe(true);
    expect(evidence.quotaUnavailable).toBe(true);
    expect(evidence.authUnavailable).toBe(false);
  });

  it("treats exhausted reconnects as terminal", () => {
    expect(
      inspectCodexProviderError({
        message: "Reconnecting... 5/5",
        willRetry: true,
      }).terminal,
    ).toBe(true);
    expect(
      inspectCodexProviderError({
        message: "stream failed",
        willRetry: true,
        codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 500 } },
      }).retriesExhausted,
    ).toBe(true);
  });

  it("treats a non-retrying error as terminal", () => {
    const evidence = inspectCodexProviderError({
      message: "the model returned an invalid response",
      willRetry: false,
    });
    expect(evidence.terminal).toBe(true);
    expect(evidence.authUnavailable).toBe(false);
  });

  it("recognizes a 401 on the structured error info", () => {
    const evidence = inspectCodexProviderError({
      message: "Reconnecting... 1/5",
      willRetry: true,
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
    });
    expect(evidence.terminal).toBe(true);
    expect(evidence.authUnavailable).toBe(true);
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
