import { describe, expect, it } from "vitest";
import { normalizeAgentAvailableCommands } from "./composer-slash-commands";
import { translate } from "./i18n";
import {
  authChoiceDescription,
  authChoiceLabel,
  authFieldInputType,
  authFieldValue,
  authVariableLabel,
  authMethodKind,
  authDialogShouldClose,
  authSubmitValues,
  clearAuthDraft,
  filterAuthMethods,
  groupAuthMethods,
  initialAuthDraft,
  isAuthSlashCommand,
  preferredAuthMethod,
  type AuthMethodChoice,
} from "./auth-method-menu";

const terminal: AuthMethodChoice = {
  id: "pi-login",
  name: "Log in with pi",
  description: "Open pi in a terminal",
  type: "terminal",
};
const anthropic: AuthMethodChoice = {
  id: "anthropic",
  name: "Sign in to Anthropic",
  description: "Claude Pro or Max in the browser",
  type: "agent",
};
const deepseek: AuthMethodChoice = {
  id: "deepseek",
  name: "DeepSeek API key",
  description: "Stored by the agent",
  type: "agent",
  form: "fields",
  vars: [{ name: "api-key", label: "API key", secret: true }],
};
const openaiEnv: AuthMethodChoice = {
  id: "openai-key",
  name: "OpenAI API key",
  type: "env_var",
  vars: [{ name: "OPENAI_API_KEY", secret: true }],
};
const gateway: AuthMethodChoice = {
  id: "custom-endpoint",
  name: "Custom gateway",
  description: "OpenAI-compatible endpoint",
  type: "agent",
  form: "fields",
  vars: [
    { name: "baseUrl", label: "Base URL" },
    { name: "api-key", label: "API key", secret: true },
    { name: "providerName", label: "Provider", optional: true },
  ],
};
const inferred: AuthMethodChoice = {
  id: "inferred-key",
  name: "Inferred key",
  vars: [{ name: "TOKEN", secret: true }],
};

describe("auth method kinds", () => {
  it("groups terminal, browser, api key, and gateway without promoting terminal", () => {
    const methods = [terminal, deepseek, gateway, anthropic, openaiEnv];
    expect(methods.map(authMethodKind)).toEqual([
      "terminal",
      "api-key",
      "gateway",
      "oauth",
      "api-key",
    ]);
    expect(authMethodKind({ id: "plain" })).toBe("oauth");
    expect(authMethodKind({ ...terminal, vars: [{ name: "baseUrl" }] })).toBe("terminal");
    expect(authMethodKind(inferred)).toBe("api-key");
    expect(groupAuthMethods(methods)).toEqual([
      { kind: "oauth", methods: [anthropic] },
      { kind: "api-key", methods: [deepseek, openaiEnv] },
      { kind: "gateway", methods: [gateway] },
      { kind: "terminal", methods: [terminal] },
    ]);
    expect(groupAuthMethods([])).toEqual([]);
    expect(preferredAuthMethod(methods)?.id).toBe("anthropic");
    expect(preferredAuthMethod([terminal, deepseek])?.id).toBe("deepseek");
    expect(preferredAuthMethod([terminal, gateway])?.id).toBe("custom-endpoint");
    expect(preferredAuthMethod([terminal])?.id).toBe("pi-login");
    expect(preferredAuthMethod([])).toBeUndefined();
  });

  it("filters by name, id, description, and kind", () => {
    const methods = [terminal, anthropic, deepseek, gateway];
    expect(filterAuthMethods(methods, "  ")).toEqual(methods);
    expect(filterAuthMethods(methods, "Deep").map((method) => method.id)).toEqual(["deepseek"]);
    expect(filterAuthMethods(methods, "pi-login").map((method) => method.id)).toEqual(["pi-login"]);
    expect(filterAuthMethods(methods, "browser").map((method) => method.id)).toEqual(["anthropic"]);
    expect(filterAuthMethods(methods, "gateway").map((method) => method.id)).toEqual(["custom-endpoint"]);
    expect(filterAuthMethods(methods, "missing")).toEqual([]);
    expect(filterAuthMethods([{ id: "only-id" }], "only-id")).toEqual([{ id: "only-id" }]);
    expect(filterAuthMethods([{ id: "blank-name", name: "" }], "blank-name")).toEqual([
      { id: "blank-name", name: "" },
    ]);
  });
});

describe("auth secret isolation", () => {
  it("does not preload an api-key field from a saved value of the same name", () => {
    const saved = new Map([["api-key", "sk-deepseek"], ["OPENAI_API_KEY", "sk-openai"]]);
    expect(initialAuthDraft(undefined, saved)).toEqual({});
    expect(initialAuthDraft(deepseek, saved)).toEqual({ "api-key": "" });
    expect(initialAuthDraft(gateway, saved)).toEqual({
      baseUrl: "",
      "api-key": "",
      providerName: "",
    });
    expect(initialAuthDraft(openaiEnv, saved)).toEqual({ OPENAI_API_KEY: "sk-openai" });
    expect(initialAuthDraft(openaiEnv)).toEqual({ OPENAI_API_KEY: "" });
  });

  it("drops the previous method draft and submits only the selected method", () => {
    const drafts = {
      deepseek: { "api-key": "sk-deepseek" },
      "custom-endpoint": { baseUrl: "https://example.test", "api-key": "sk-gateway" },
    };
    expect(clearAuthDraft(drafts, "deepseek")).toEqual({
      "custom-endpoint": { baseUrl: "https://example.test", "api-key": "sk-gateway" },
    });
    expect(clearAuthDraft(drafts, undefined)).toEqual(drafts);
    expect(clearAuthDraft(drafts, "missing")).toEqual(drafts);
    expect(authSubmitValues(deepseek, {
      "api-key": "sk-deepseek",
      baseUrl: "https://should-not-submit.example",
    })).toEqual({ "api-key": "sk-deepseek" });
    expect(authSubmitValues(anthropic, { "api-key": "sk-deepseek" })).toEqual({});
    expect(authSubmitValues(deepseek, {})).toEqual({ "api-key": "" });
  });

  it("chooses password inputs only for secret fields", () => {
    expect(authFieldInputType(openaiEnv, { name: "OPENAI_API_KEY", secret: true })).toBe("password");
    expect(authFieldInputType(openaiEnv, { name: "OPENAI_API_KEY" })).toBe("password");
    expect(authFieldInputType(
      { ...openaiEnv, vars: [{ name: "OPENAI_ORG", secret: false }] },
      { name: "OPENAI_ORG", secret: false },
    )).toBe("text");
    expect(authFieldInputType(deepseek, { name: "api-key", secret: true })).toBe("password");
    expect(authFieldInputType(gateway, { name: "baseUrl" })).toBe("text");
    expect(authFieldInputType(gateway, { name: "providerName", secret: false })).toBe("text");
    expect(authChoiceLabel({ id: "deepseek", name: "DeepSeek" })).toBe("DeepSeek");
    expect(authChoiceLabel({ id: "deepseek" })).toBe("deepseek");
    expect(authChoiceDescription({ description: "Stored" })).toBe("Stored");
    expect(authChoiceDescription({})).toBe("");
    expect(authVariableLabel({ name: "OPENAI_API_KEY", label: "Key" }, true)).toBe("OPENAI_API_KEY");
    expect(authVariableLabel({ name: "api-key", label: "API key" }, false)).toBe("API key");
    expect(authVariableLabel({ name: "api-key" }, false)).toBe("api-key");
    expect(authFieldValue({ "api-key": "sk" }, "api-key")).toBe("sk");
    expect(authFieldValue({}, "api-key")).toBe("");
  });
});

describe("auth slash commands", () => {
  it("recognizes only login and logout", () => {
    expect(isAuthSlashCommand("login")).toBe(true);
    expect(isAuthSlashCommand("Logout")).toBe(true);
    expect(isAuthSlashCommand("  LOGIN  ")).toBe(true);
    expect(isAuthSlashCommand("status")).toBe(false);
    expect(isAuthSlashCommand("")).toBe(false);
    expect(authDialogShouldClose(true, false)).toBe(false);
    expect(authDialogShouldClose(true, true)).toBe(false);
    expect(authDialogShouldClose(false, true)).toBe(false);
    expect(authDialogShouldClose(false, false)).toBe(true);
    expect(translate("en", "auth.setupTitle", { agent: "pi" })).toBe("Set up pi");
    expect(translate("zh-CN", "auth.setupTitle", { agent: "pi" })).toBe("设置 pi");
    expect(translate("en", "auth.group.gateway")).toBe("Gateway");
    expect(translate("zh-CN", "auth.group.gateway")).toBe("网关");
    expect(translate("zh-CN", "auth.logout")).toBe("退出登录");
    expect(translate("zh-CN", "auth.searchEmpty")).toBe("没有匹配的认证方式。");
  });

  it("removes advertised auth slash commands from the composer catalogue", () => {
    expect(normalizeAgentAvailableCommands([
      { name: "login", description: "Log in" },
      { name: "logout", description: "Log out" },
      { name: "status", description: "Status" },
    ]).map((command) => command.name)).toEqual(["status"]);
  });
});
