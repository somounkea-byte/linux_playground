import { z } from "zod";
import { checksSchema } from "@/lib/linux-engine";

export const moduleSchema = z.object({
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().min(2).max(500),
  icon: z.string().max(40).default("terminal"),
  isPublished: z.boolean().default(true),
});

export const lessonSchema = z.object({
  moduleId: z.string().min(1).max(40),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(2).max(300),
  content: z.string().min(1).max(50000),
  practice: z.array(z.object({ command: z.string().min(1).max(500), explanation: z.string().max(300) })).max(20).default([]),
  checks: checksSchema.default([]),
  xpReward: z.number().int().min(0).max(200).default(20),
  estimatedMinutes: z.number().int().min(1).max(240).default(10),
  isPublished: z.boolean().default(true),
});

export const lessonPatchSchema = lessonSchema.omit({ moduleId: true }).partial().extend({ order: z.number().int().min(0).max(1000).optional() });
