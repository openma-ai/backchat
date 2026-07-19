export const SUBAGENT_AVATAR_IDS = [
  "1_01", "1_02", "1_03", "1_04", "1_05",
  "2_01", "2_02", "2_03", "2_04", "2_05",
  "3_01", "3_02", "3_03", "3_04", "3_05",
  "4_01", "4_02", "4_03", "4_04", "4_05",
  "5_01", "5_02", "5_03", "5_04", "5_05",
] as const;

export type SubagentAvatarId = (typeof SUBAGENT_AVATAR_IDS)[number];

/** Stable FNV-1a assignment. The renderer keeps the chosen id when a
 * provider later replaces a temporary tool-call child id with a native one. */
export function subagentAvatarId(seed: string): SubagentAvatarId {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return SUBAGENT_AVATAR_IDS[(hash >>> 0) % SUBAGENT_AVATAR_IDS.length]!;
}
