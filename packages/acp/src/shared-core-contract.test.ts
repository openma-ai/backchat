import { describe, expect, it } from "vitest";
import { AcpRuntimeImpl as LocalRuntime, AcpSessionImpl as LocalSession } from "./index";
import {
  AcpRuntimeImpl as SharedRuntime,
  AcpSessionImpl as SharedSession,
} from "@openma/common/acp-runtime";

describe("desktop ACP package", () => {
  it("layers the ACP 1.1 multi-root transport over the shared runtime core", () => {
    expect(LocalRuntime).not.toBe(SharedRuntime);
    expect(LocalSession).not.toBe(SharedSession);
    expect(Object.getPrototypeOf(LocalSession.prototype)).toBe(
      SharedSession.prototype,
    );
  });
});
