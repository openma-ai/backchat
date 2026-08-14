export function toggleDisabledPlugin(
  disabledPlugins: readonly string[],
  pluginId: string,
  enabled: boolean,
): string[] {
  const next = new Set(disabledPlugins);
  if (enabled) next.delete(pluginId);
  else next.add(pluginId);
  return [...next].sort();
}
