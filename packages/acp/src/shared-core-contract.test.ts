import { describe, expect, it } from "vitest";
import { AcpRuntimeImpl as LocalRuntime, AcpSessionImpl as LocalSession } from "./index";
import {
  AcpRuntimeImpl as SharedRuntime,
  AcpSessionImpl as SharedSession,
} from "@openma/common/acp-runtime";

describe("desktop ACP package", () => {
  it("uses the shared runtime and session implementation directly", () => {
    expect(LocalRuntime).toBe(SharedRuntime);
    expect(LocalSession).toBe(SharedSession);
  });
});
