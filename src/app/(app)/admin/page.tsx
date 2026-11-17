import { Activity, BookOpen, GraduationCap, Server, ShieldCheck, SquareTerminal, Users } from "lucide-react";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { SimpleBarChart } from "@/components/charts/xp-chart";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Admin Dashboard" };

export default async function AdminDashboard() {
  await requireUser(["ADMIN"]);
  const since = new Date(Date.now() - 30 * 86400000);
  const week = new Date(Date.now() - 7 * 86400000);
  const [byRole, newUsers, commands30, activeWeek, envs, lessons, exercises, quizzes, audits, signups] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: true }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.commandLog.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { lastLoginAt: { gte: week } } }),
    prisma.virtualEnvironment.count(),
    prisma.lesson.count(),
    prisma.exercise.count(),
    prisma.quiz.count(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { name: true } } } }),
    prisma.$queryRaw<{ day: string; count: bigint }[]>`SELECT to_char(date_trunc('day', "createdAt"), 'MM-DD') AS day, count(*) AS count FROM "CommandLog" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
  ]);
  const role = (r: string) => byRole.find((x) => x.role === r)?._count ?? 0;
  return (
    <>
      <PageHeader icon={<ShieldCheck className="size-6 text-primary" />} title="Admin Dashboard" description="Platform analytics and recent administrative activity." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Students" value={role("STUDENT")} icon={<GraduationCap />} hint={`${newUsers} new accounts in 30 days`} />
        <StatCard label="Teachers / admins" value={`${role("TEACHER")} / ${role("ADMIN")}`} icon={<Users />} />
        <StatCard label="Active users (7 days)" value={activeWeek} icon={<Activity />} />
        <StatCard label="Commands run (30 days)" value={commands30} icon={<SquareTerminal />} />
        <StatCard label="Virtual environments" value={envs} icon={<Server />} />
        <StatCard label="Lessons" value={lessons} icon={<BookOpen />} />
        <StatCard label="Exercises & challenges" value={exercises} />
        <StatCard label="Quizzes" value={quizzes} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Terminal usage per day</h2>
          <SimpleBarChart data={signups.map((s) => ({ day: s.day, commands: Number(s.count) }))} xKey="day" yKey="commands" label="Commands" />
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Recent audit events</h2>
          <ul className="space-y-2 text-sm">
            {audits.map((a) => (
              <li key={a.id}>
                <span className="font-mono text-xs text-primary">{a.action}</span>
                <span className="block text-xs text-muted-foreground">
                  {a.actor?.name ?? "system"} · {timeAgo(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
