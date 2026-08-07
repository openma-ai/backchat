export const SUBAGENT_AVATAR_IDS = [
  "1_01", "1_02", "1_03", "1_04", "1_05",
  "2_01", "2_02", "2_03", "2_04", "2_05",
  "3_01", "3_02", "3_03", "3_04", "3_05",
  "4_01", "4_02", "4_03", "4_04", "4_05",
  "5_01", "5_02", "5_03", "5_04", "5_05",
] as const;

export type SubagentAvatarId = (typeof SUBAGENT_AVATAR_IDS)[number];

const SUBAGENT_MONIKERS: Record<SubagentAvatarId, string> = {
  "1_01": "Aster",
  "1_02": "Babbage",
  "1_03": "Curie",
  "1_04": "Darwin",
  "1_05": "Euler",
  "2_01": "Faraday",
  "2_02": "Gauss",
  "2_03": "Halley",
  "2_04": "Hopper",
  "2_05": "Iris",
  "3_01": "Joule",
  "3_02": "Kepler",
  "3_03": "Lagrange",
  "3_04": "Lovelace",
  "3_05": "Maxwell",
  "4_01": "Noether",
  "4_02": "Ohm",
  "4_03": "Pascal",
  "4_04": "Quine",
  "4_05": "Raman",
  "5_01": "Sagan",
  "5_02": "Turing",
  "5_03": "Volta",
  "5_04": "Weyl",
  "5_05": "Zephyr",
};

export function subagentMoniker(avatarId: SubagentAvatarId): string {
  return SUBAGENT_MONIKERS[avatarId];
}

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
