import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeIcon } from "@/components/app/icons";
import { ProgressBar, StatCard } from "@/components/app/page-header";
import { XpChart } from "@/components/charts/xp-chart";
import { formatDate, timeAgo } from "@/lib/format";
import { levelTitle } from "@/lib/gamification";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { modulesWithProgress } from "@/server/services/learning";
import { xpHistory } from "@/server/services/student";
import { studentScope } from "@/server/services/teacher";

export const metadata = { title: "Student profile" };

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const s = await prisma.studentProfile.findFirst({ where: { id, ...studentScope(user) }, include: { user: true, badges: { include: { badge: true } } } });
  if (!s) notFound();
  const [modules, history, subs, quizzes, activities, commands] = await Promise.all([
    modulesWithProgress(s.id),
    xpHistory(s.id, 30),
    prisma.exerciseSubmission.findMany({ where: { studentId: s.id }, include: { exercise: { select: { title: true, difficulty: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.quizAttempt.findMany({ where: { studentId: s.id, submittedAt: { not: null } }, include: { quiz: { select: { title: true } } }, orderBy: { submittedAt: "desc" } }),
    prisma.studentActivity.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.commandLog.findMany({ where: { userId: s.userId }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const lessonsDone = modules.reduce((a, m) => a + m.completed, 0);
  const lessonsTotal = modules.reduce((a, m) => a + m.total, 0);
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/teacher/students" className="hover:text-foreground">
          Students
        </Link>
        <ChevronRight className="size-3.5" /> {s.user.name}
      </nav>
      <div>
        <h1 className="text-2xl font-semibold">{s.user.name}</h1>
        <p className="text-sm text-muted-foreground">
          {s.user.email} · joined {formatDate(s.createdAt)} · last login {s.user.lastLoginAt ? timeAgo(s.user.lastLoginAt) : "never"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Level" value={s.level} hint={levelTitle(s.level)} />
        <StatCard label="XP" value={s.xp} />
        <StatCard label="Lessons" value={`${lessonsDone}/${lessonsTotal}`} />
        <StatCard label="Challenges passed" value={subs.filter((x) => x.status === "PASSED").length} />
        <StatCard label="Streak" value={`${s.currentStreak} d`} hint={`${s.commandsRun} commands run`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">XP (30 days)</h2>
          <XpChart data={history} />
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Completed lessons by module</h2>
          <div className="space-y-2">
            {modules.map((m) => (
              <div key={m.id}>
                <div className="flex justify-between text-sm">
                  <span>{m.title}</span>
                  <span className="text-muted-foreground">
                    {m.completed}/{m.total}
                  </span>
                </div>
                <ProgressBar value={m.percent} className="mt-1 h-1.5" />
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Exercise scores & challenge history</h2>
          <table className="w-full text-sm">
            <tbody>
              {subs.map((x) => (
                <tr key={x.id} className="border-t first:border-0">
                  <td className="py-2">{x.exercise.title}</td>
                  <td className={`py-2 text-xs ${x.status === "PASSED" ? "text-success" : "text-warning"}`}>{x.status.toLowerCase().replace("_", " ")}</td>
                  <td className="py-2 text-right text-xs text-muted-foreground">
                    {x.score}% · {x.attempts} checks · {x.hintsUsed} hints
                  </td>
                </tr>
              ))}
              {!subs.length && (
                <tr>
                  <td className="text-sm text-muted-foreground">No attempts.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Quiz scores</h2>
          <ul className="divide-y text-sm">
            {quizzes.map((q) => (
              <li key={q.id} className="flex justify-between py-2">
                <span>{q.quiz.title}</span>
                <span className={q.passed ? "text-success" : "text-warning"}>{q.score}%</span>
              </li>
            ))}
            {!quizzes.length && <li className="text-muted-foreground">No quizzes taken.</li>}
          </ul>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Badges</h2>
          <div className="flex flex-wrap gap-2">
            {s.badges.map((b) => (
              <span key={b.id} title={b.badge.name}>
                <BadgeIcon icon={b.badge.icon} />
              </span>
            ))}
            {!s.badges.length && <p className="text-sm text-muted-foreground">None yet.</p>}
          </div>
          <h2 className="mb-2 mt-5 font-semibold">Recent activity</h2>
          <ul className="space-y-1 text-sm">
            {activities.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span className="truncate">{a.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Recent terminal commands</h2>
          <ul className="space-y-1 font-mono text-xs">
            {commands.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className={`truncate ${c.exitCode ? "text-destructive" : ""}`}>$ {c.command}</span>
                <span className="shrink-0 text-muted-foreground">{timeAgo(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
