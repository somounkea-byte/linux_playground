/** Shared (client + server) gamification rules. */

export const XP_RULES = {
  lesson: 20,
  challenge: { BEGINNER: 50, INTERMEDIATE: 100, ADVANCED: 200 } as Record<string, number>,
  quiz: 30,
  daily: 10,
};

/** Total XP required to reach `level` (level 1 = 0 XP, 2 = 100, 3 = 300, ...). */
export function xpForLevel(level: number): number {
  return (100 * level * (level - 1)) / 2;
}

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2));
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const current = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current, next, into: xp - current, needed: next - current, percent: Math.round(((xp - current) / (next - current)) * 100) };
}

const TITLES = ["Newbie", "Terminal Tourist", "Shell Apprentice", "Command Crafter", "File Wrangler", "Permission Keeper", "Process Tamer", "Script Smith", "System Steward", "Linux Expert"];

export function levelTitle(level: number): string {
  return TITLES[Math.min(TITLES.length, Math.max(1, level)) - 1];
}
