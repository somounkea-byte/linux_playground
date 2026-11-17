import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { badRequest, route } from "@/server/http";
import { exercisePerformance, moduleCompletion, quizPerformance, studentRows, toCsv } from "@/server/services/teacher";

/** CSV exports: ?report=students|modules|exercises|quizzes|student&id=... */
export const GET = route({ roles: ["TEACHER", "ADMIN"], rateLimit: { bucket: "reports", limit: 30 } }, async ({ req, user }) => {
  const report = req.nextUrl.searchParams.get("report") ?? "students";
  const rows = await studentRows(user);
  const ids = rows.map((r) => r.id);
  let data: Record<string, unknown>[];
  switch (report) {
    case "students":
      data = rows.map((r) => ({ name: r.name, email: r.email, level: r.level, xp: r.xp, lessons_completed: r.lessonsDone, lesson_progress_pct: r.lessonPercent, challenges_passed: r.challengesPassed, avg_quiz_pct: r.avgQuiz ?? "", streak_days: r.streak, last_active: r.lastActive ?? "", needs_support: r.reasons.join("; ") }));
      break;
    case "modules":
      data = (await moduleCompletion(ids)).map((m) => ({ module: m.title, completion_pct: m.completion }));
      break;
    case "exercises":
      data = (await exercisePerformance(ids)).map((e) => ({ exercise: e.title, kind: e.kind, difficulty: e.difficulty, attempted: e.attempted, passed: e.passed, pass_rate_pct: e.passRate, avg_score_pct: e.avgScore, avg_checks: e.avgChecks, avg_hints: e.avgHints }));
      break;
    case "quizzes":
      data = (await quizPerformance(ids)).map((q) => ({ quiz: q.title, attempts: q.attempts, avg_score_pct: q.avgScore, pass_rate_pct: q.passRate }));
      break;
    case "student": {
      const id = req.nextUrl.searchParams.get("id");
      if (!id || !ids.includes(id)) throw badRequest("Unknown student");
      const progress = await prisma.studentProgress.findMany({ where: { studentId: id }, include: { lesson: { include: { module: true } } }, orderBy: { completedAt: "asc" } });
      data = progress.map((p) => ({ module: p.lesson.module.title, lesson: p.lesson.title, status: p.status, completed_at: p.completedAt ?? "" }));
      break;
    }
    default:
      throw badRequest("Unknown report");
  }
  return new NextResponse(toCsv(data), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="linux-playground-${report}-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
});
