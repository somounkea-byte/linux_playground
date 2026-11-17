import type { Check } from "../../src/lib/linux-engine/checks";

export interface SeedLesson {
  slug: string;
  title: string;
  summary: string;
  minutes: number;
  content: string;
  practice: { command: string; explanation: string }[];
  checks?: Check[];
}

export interface SeedModule {
  slug: string;
  title: string;
  description: string;
  icon: string;
  lessons: SeedLesson[];
}

/** Task that passes once the student has run a command matching `pattern`. */
export const ran = (id: string, pattern: string, description: string): Check => ({ id, type: "history_contains", pattern, description });
