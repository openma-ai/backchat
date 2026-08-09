/**
 * Canonical renderer cache for Agent discovery and managed-runtime state.
 * Every surface reads and writes this key so installs, upgrades, auth, and
 * version availability cannot diverge between the sidebar and Settings.
 */
export const AGENTS_QUERY_KEY = ["agents"] as const;
