/**
 * Quiz question formats and grading. Pure functions shared by the server
 * (grading) and tests.
 */
import { z } from "zod";
import { checksSchema, evaluateChecks } from "./linux-engine/checks";
import { buildChallengeState, runCommands } from "./linux-engine/setup";

export const QUESTION_TYPES = ["MULTIPLE_CHOICE", "TRUE_FALSE", "FILL_BLANK", "MATCHING", "PERMISSION", "PREDICT_OUTPUT", "PRACTICAL"] as const;
export type QuestionTypeName = (typeof QUESTION_TYPES)[number];

export const questionDefinitionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("MULTIPLE_CHOICE"),
    options: z.object({ choices: z.array(z.string().min(1).max(500)).min(2).max(8), multiple: z.boolean().optional() }),
    answer: z.object({ correct: z.array(z.number().int().min(0)).min(1) }),
  }),
  z.object({ type: z.literal("TRUE_FALSE"), options: z.object({}).passthrough(), answer: z.object({ value: z.boolean() }) }),
  z.object({
    type: z.literal("FILL_BLANK"),
    options: z.object({ placeholder: z.string().max(100).optional() }).passthrough(),
    answer: z.object({ accepted: z.array(z.string().min(1).max(500)).min(1), caseSensitive: z.boolean().optional() }),
  }),
  z.object({
    type: z.literal("PERMISSION"),
    options: z.object({ format: z.enum(["numeric", "symbolic"]).default("numeric") }).passthrough(),
    answer: z.object({ accepted: z.array(z.string().min(1).max(20)).min(1) }),
  }),
  z.object({
    type: z.literal("PREDICT_OUTPUT"),
    options: z.object({ command: z.string().max(1000), choices: z.array(z.string().max(1000)).max(8).optional() }),
    answer: z.object({ correct: z.array(z.number().int()).optional(), accepted: z.array(z.string().max(2000)).optional() }),
  }),
  z.object({
    type: z.literal("MATCHING"),
    options: z.object({ left: z.array(z.string().min(1).max(300)).min(2).max(10), right: z.array(z.string().min(1).max(300)).min(2).max(10) }),
    answer: z.object({ pairs: z.array(z.number().int().min(0)) }),
  }),
  z.object({
    type: z.literal("PRACTICAL"),
    options: z.object({ task: z.string().min(1).max(2000), setupScript: z.string().max(5000).optional() }),
    answer: z.object({ checks: checksSchema }),
  }),
]);

export type QuestionDefinition = z.infer<typeof questionDefinitionSchema>;

export interface StoredQuestion {
  id: string;
  type: QuestionTypeName;
  prompt: string;
  options: unknown;
  answer: unknown;
  explanation?: string | null;
  points: number;
}

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  earned: number;
  points: number;
  given: unknown;
  correctAnswer: string;
  explanation?: string | null;
  feedback?: string;
}

const norm = (s: string, caseSensitive = false) => {
  const t = s.trim().replace(/\s+/g, " ");
  return caseSensitive ? t : t.toLowerCase();
};

function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let s = seed || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The question as shown to a student: no answers, shuffled choices. */
export function publicQuestion(q: StoredQuestion, seed: number) {
  const base = { id: q.id, type: q.type, prompt: q.prompt, points: q.points };
  const o = q.options as Record<string, unknown>;
  switch (q.type) {
    case "MULTIPLE_CHOICE":
    case "PREDICT_OUTPUT": {
      const choices = (o.choices as string[] | undefined) ?? [];
      const answer = q.answer as { correct?: number[] };
      return {
        ...base,
        command: o.command as string | undefined,
        multiple: !!o.multiple || (answer.correct?.length ?? 0) > 1,
        choices: shuffleSeeded(choices.map((text, id) => ({ id, text })), seed),
      };
    }
    case "MATCHING": {
      const right = (o.right as string[]).map((text, id) => ({ id, text }));
      return { ...base, left: o.left as string[], right: shuffleSeeded(right, seed) };
    }
    case "PRACTICAL":
      return { ...base, task: o.task as string };
    case "PERMISSION":
      return { ...base, format: (o.format as string) ?? "numeric" };
    case "FILL_BLANK":
      return { ...base, placeholder: o.placeholder as string | undefined };
    default:
      return base;
  }
}

export type PublicQuestion = ReturnType<typeof publicQuestion>;

export function describeAnswer(q: StoredQuestion): string {
  const o = q.options as Record<string, unknown>;
  const a = q.answer as Record<string, unknown>;
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return (a.correct as number[]).map((i) => (o.choices as string[])[i]).join(", ");
    case "TRUE_FALSE":
      return a.value ? "True" : "False";
    case "FILL_BLANK":
    case "PERMISSION":
      return (a.accepted as string[])[0];
    case "PREDICT_OUTPUT":
      return a.correct ? (a.correct as number[]).map((i) => (o.choices as string[])[i]).join(", ") : ((a.accepted as string[])?.[0] ?? "");
    case "MATCHING":
      return (o.left as string[]).map((l, i) => `${l} → ${(o.right as string[])[(a.pairs as number[])[i]]}`).join("; ");
    case "PRACTICAL":
      return (a.checks as { description: string }[]).map((c) => c.description).join("; ");
  }
}

export function gradeQuestion(q: StoredQuestion, given: unknown, now?: number): QuestionResult {
  const o = q.options as Record<string, unknown>;
  const a = q.answer as Record<string, unknown>;
  const result = (fraction: number, feedback?: string): QuestionResult => ({
    questionId: q.id,
    correct: fraction >= 1,
    earned: Math.round(q.points * Math.max(0, Math.min(1, fraction)) * 100) / 100,
    points: q.points,
    given: given ?? null,
    correctAnswer: describeAnswer(q),
    explanation: q.explanation,
    feedback,
  });
  if (given === undefined || given === null || given === "") return result(0, "Not answered");
  switch (q.type) {
    case "MULTIPLE_CHOICE":
    case "PREDICT_OUTPUT": {
      if (q.type === "PREDICT_OUTPUT" && !a.correct) {
        if (typeof given !== "string") return result(0);
        return result((a.accepted as string[]).some((x) => norm(x, true) === norm(given, true)) ? 1 : 0);
      }
      const chosen = (Array.isArray(given) ? given : [given]).map(Number).sort();
      const correct = [...(a.correct as number[])].sort();
      return result(chosen.length === correct.length && chosen.every((v, i) => v === correct[i]) ? 1 : 0);
    }
    case "TRUE_FALSE":
      return result(given === a.value || String(given) === String(a.value) ? 1 : 0);
    case "FILL_BLANK":
      if (typeof given !== "string") return result(0);
      return result((a.accepted as string[]).some((x) => norm(x, !!a.caseSensitive) === norm(given, !!a.caseSensitive)) ? 1 : 0);
    case "PERMISSION": {
      if (typeof given !== "string") return result(0);
      const g = given.trim().replace(/^0(?=\d{3}$)/, "");
      return result((a.accepted as string[]).some((x) => x.trim() === g) ? 1 : 0);
    }
    case "MATCHING": {
      if (!Array.isArray(given)) return result(0);
      const pairs = a.pairs as number[];
      const right = pairs.filter((p, i) => Number(given[i]) === p).length;
      return result(right / pairs.length);
    }
    case "PRACTICAL": {
      if (typeof given !== "string") return result(0);
      const state = buildChallengeState((o.setupScript as string) ?? "", { now });
      runCommands(state, given.split("\n"), now);
      const checks = checksSchema.parse(a.checks);
      const res = evaluateChecks(state, checks, now);
      const passed = res.filter((r) => r.passed).length;
      return result(passed / res.length, res.map((r) => `${r.passed ? "✔" : "✘"} ${r.description}${r.passed || !r.detail ? "" : ` (${r.detail})`}`).join("\n"));
    }
  }
}

export function gradeAttempt(questions: StoredQuestion[], answers: Record<string, unknown>, passingScore: number, now?: number) {
  const results = questions.map((q) => gradeQuestion(q, answers[q.id], now));
  const total = results.reduce((s, r) => s + r.points, 0) || 1;
  const earned = results.reduce((s, r) => s + r.earned, 0);
  const score = Math.round((earned / total) * 100);
  return { results, earned, total, score, passed: score >= passingScore };
}
