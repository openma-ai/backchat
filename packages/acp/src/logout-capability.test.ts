import { describe, expect, it, vi } from "vitest";
import { acpLogoutAdvertised, callAcpLogout } from "./logout-capability.js";

describe("acpLogoutAdvertised", () => {
  it("accepts only an advertised logout capability object", () => {
    expect(acpLogoutAdvertised(undefined)).toBe(false);
    expect(acpLogoutAdvertised(null)).toBe(false);
    expect(acpLogoutAdvertised("logout")).toBe(false);
    expect(acpLogoutAdvertised({})).toBe(false);
    expect(acpLogoutAdvertised({ auth: null })).toBe(false);
    expect(acpLogoutAdvertised({ auth: "yes" })).toBe(false);
    expect(acpLogoutAdvertised({ auth: {} })).toBe(false);
    expect(acpLogoutAdvertised({ auth: { logout: null } })).toBe(false);
    expect(acpLogoutAdvertised({ auth: { logout: {} } })).toBe(true);
    expect(acpLogoutAdvertised({ auth: { logout: { _meta: { vendor: true } } } })).toBe(true);
  });

  it("calls logout only after the capability is advertised", async () => {
    const logout = vi.fn(async () => undefined);
    await expect(callAcpLogout({ logout }, { auth: { logout: {} } })).resolves.toBeUndefined();
    expect(logout).toHaveBeenCalledWith({});
    await expect(callAcpLogout({ logout }, {})).rejects.toThrow(/does not support ACP logout/);
    await expect(callAcpLogout({}, { auth: { logout: {} } })).rejects.toThrow(/not available/);
    logout.mockRejectedValueOnce(new Error("rejected"));
    await expect(callAcpLogout({ logout }, { auth: { logout: {} } })).rejects.toThrow("rejected");
  });
});
