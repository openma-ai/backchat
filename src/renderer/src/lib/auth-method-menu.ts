/**
 * Auth-method presentation for the setup dialog.
 *
 * Kind order follows the pattern used by Codex and Claude Code desktop:
 * subscription / browser sign-in first, then API keys, then a custom
 * gateway, and terminal login last. The terminal method stays available,
 * but it is not the default when any other method exists.
 */

export type AuthMethodKind = "oauth" | "api-key" | "gateway" | "terminal";

export interface AuthMethodChoice {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  form?: "fields";
  vars?: Array<{
    name: string;
    label?: string;
    secret?: boolean;
    optional?: boolean;
  }>;
  link?: string;
}

export const AUTH_METHOD_GROUP_ORDER: readonly AuthMethodKind[] = [
  "oauth",
  "api-key",
  "gateway",
  "terminal",
];

const AUTH_SLASH_COMMANDS = new Set(["login", "logout"]);

export function authMethodKind(method: AuthMethodChoice): AuthMethodKind {
  if ((method.type ?? "agent") === "terminal") return "terminal";
  const vars = method.vars ?? [];
  if (vars.some((variable) => variable.name === "baseUrl")) return "gateway";
  if (method.type === "env_var" || method.form === "fields" || vars.length > 0) {
    return "api-key";
  }
  return "oauth";
}

export function groupAuthMethods<T extends AuthMethodChoice>(
  methods: readonly T[],
): Array<{ kind: AuthMethodKind; methods: T[] }> {
  const buckets = new Map<AuthMethodKind, T[]>();
  for (const method of methods) {
    const kind = authMethodKind(method);
    const group = buckets.get(kind) ?? [];
    group.push(method);
    buckets.set(kind, group);
  }
  return AUTH_METHOD_GROUP_ORDER.flatMap((kind) => {
    const group = buckets.get(kind);
    return group && group.length > 0 ? [{ kind, methods: group }] : [];
  });
}

/** First method in kind order. Terminal is used only when nothing else exists. */
export function preferredAuthMethod<T extends AuthMethodChoice>(
  methods: readonly T[],
): T | undefined {
  for (const kind of AUTH_METHOD_GROUP_ORDER) {
    const match = methods.find((method) => authMethodKind(method) === kind);
    if (match) return match;
  }
  return undefined;
}

export function filterAuthMethods<T extends AuthMethodChoice>(
  methods: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...methods];
  return methods.filter((method) => {
    const haystack = [
      method.name,
      method.id,
      method.description,
      authMethodKind(method),
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * Draft shown when a method is selected.
 * API-key and gateway fields start empty so a secret typed for one provider
 * cannot be submitted as another. Env-var methods may show that method's own
 * saved values, because those names are the method's variables.
 */
export function initialAuthDraft(
  method: AuthMethodChoice | undefined,
  savedEnv?: ReadonlyMap<string, string>,
): Record<string, string> {
  if (!method) return {};
  const vars = method.vars ?? [];
  if (method.type !== "env_var") {
    return Object.fromEntries(vars.map((variable) => [variable.name, ""]));
  }
  return Object.fromEntries(
    vars.map((variable) => [variable.name, savedEnv?.get(variable.name) ?? ""]),
  );
}

/** Drop the previous method's draft, including any secret it held. */
export function clearAuthDraft(
  drafts: Readonly<Record<string, Record<string, string>>>,
  previousMethodId: string | undefined,
): Record<string, Record<string, string>> {
  if (!previousMethodId || !Object.prototype.hasOwnProperty.call(drafts, previousMethodId)) {
    return { ...drafts };
  }
  const next = { ...drafts };
  delete next[previousMethodId];
  return next;
}

/** Values submitted for this method only. Foreign field names are ignored. */
export function authSubmitValues(
  method: AuthMethodChoice,
  draft: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    (method.vars ?? []).map((variable) => [variable.name, draft[variable.name] ?? ""]),
  );
}

export function authChoiceLabel(choice: { id: string; name?: string }): string {
  return choice.name ?? choice.id;
}

export function authChoiceDescription(choice: { description?: string }): string {
  return choice.description ?? "";
}

export function authVariableLabel(
  variable: { name: string; label?: string },
  envForm: boolean,
): string {
  if (envForm) return variable.name;
  return variable.label ?? variable.name;
}

export function authFieldValue(draft: Readonly<Record<string, string>>, name: string): string {
  const value = draft[name];
  return value ?? "";
}

export function authFieldInputType(
  method: AuthMethodChoice,
  variable: NonNullable<AuthMethodChoice["vars"]>[number],
): "password" | "text" {
  if (method.type === "env_var") return variable.secret === false ? "text" : "password";
  return variable.secret === true ? "password" : "text";
}

/** Claude Agent ACP does not advertise /login or /logout. Clients use ACP. */
export function isAuthSlashCommand(name: string): boolean {
  return AUTH_SLASH_COMMANDS.has(name.trim().toLowerCase());
}

/** Drop auth slash commands from a live catalogue or a cached snapshot. */
export function withoutAuthSlashCommands<T extends { name?: string }>(
  commands: readonly T[],
): T[] {
  return commands.filter((command) =>
    typeof command.name !== "string" || !isAuthSlashCommand(command.name),
  );
}

/**
 * Logout switches an account that is already signed in. A needs-auth agent
 * can advertise the capability and still must not offer Log out in the
 * sign-in dialog.
 */
export function canOfferAuthLogout(
  agent: { auth?: { status?: string; supportsLogout?: boolean } | null } | null | undefined,
  options: { authRequired?: boolean; sessionSupportsLogout?: boolean } = {},
): boolean {
  if (options.authRequired) return false;
  const auth = agent?.auth;
  if (auth?.status !== "configured") return false;
  return options.sessionSupportsLogout === true || auth.supportsLogout === true;
}

/** Overlay and Escape dismiss the dialog only when no auth request is in flight. */
export function authDialogShouldClose(nextOpen: boolean, busy: boolean): boolean {
  return !nextOpen && !busy;
}
