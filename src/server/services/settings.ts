import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";

export const DEFAULT_SETTINGS = {
  registrationOpen: true,
  maintenanceMessage: "",
  defaultTerminalFontSize: 14,
};

export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.systemSetting.findMany();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as Settings;
}

export async function updateSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await prisma.systemSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
  }
  return getSettings();
}
