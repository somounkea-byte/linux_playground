import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { PageHeader, ProgressBar, StatCard } from "@/components/app/page-header";
import { XpChart } from "@/components/charts/xp-chart";
import { formatDate, timeAgo } from "@/lib/format";
import { levelProgress, levelTitle } from "@/lib/gamification";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { modulesWithProgress } from "@/server/services/learning";
import { xpHistory } from "@/server/services/student";

export const metadata = { title: "My Progress" };

export default async function ProgressPage() {
  const user = await requireUser();
  if (!user.studentProfile) redirect("/dashboard");
  const sid = user.studentProfile.id;
  const [profile, modules, history, tx, activities, subs, commands] = await Promise.all([
    prisma.studentProfile.findUniqueOrThrow({ where: { id: sid } }),
    modulesWithProgress(sid),
    xpHistory(sid, 30),
    prisma.studentXPTransaction.findMany({ where: { studentId: sid }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.studentActivity.findMany({ where: { studentId: sid }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.exerciseSubmission.findMany({ where: { studentId: sid }, include: { exercise: { select: { title: true, slug: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.commandLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15, select: { command: true, exitCode: true, createdAt: true } }),
  ]);
  const lp = levelProgress(profile.xp);
  return (
    <>
      <PageHeader icon={<TrendingUp className="size-6 text-primary" />} title="My Progress" description="Your XP, learning history and everything you have completed." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Level" value={`${lp.level} · ${levelTitle(lp.level)}`} hint={<ProgressBar value={lp.percent} className="mt-1 h-1.5" />} />
        <StatCard label="Total XP" value={profile.xp} hint={`${lp.needed - lp.into} XP to next level`} />
        <StatCard label="Commands run" value={profile.commandsRun} hint={`${profile.distinctCommands.length} different commands`} />
        <StatCard label="Streak" value={`${profile.currentStreak} days`} hint={`Longest ${profile.longestStreak} days`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">XP over the last 30 days</h2>
          <XpChart data={history} />
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Modules</h2>
          <div className="space-y-2.5">
            {modules.map((m) => (
              <div key={m.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{m.title}</span>
                  <span className="text-muted-foreground">
                    {m.completed}/{m.total}
                  </span>
                </div>
                <ProgressBar value={m.percent} className="h-1.5" tone={m.percent === 100 ? "success" : "primary"} />
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Challenge history</h2>
          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No challenges attempted yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className="border-t first:border-0">
                    <td className="py-2">{s.exercise.title}</td>
                    <td className={`py-2 text-xs font-medium ${s.status === "PASSED" ? "text-success" : s.status === "FAILED" ? "text-warning" : "text-muted-foreground"}`}>{s.status.replace("_", " ").toLowerCase()}</td>
                    <td className="py-2 text-right text-xs text-muted-foreground">
                      {s.score}% · {s.attempts} checks
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">XP transactions</h2>
          <ul className="divide-y text-sm">
            {tx.map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-2">
                <span className="truncate">{t.reason}</span>
                <span className="shrink-0 font-mono text-success">+{t.amount}</span>
              </li>
            ))}
            {!tx.length && <li className="py-2 text-muted-foreground">No XP yet.</li>}
          </ul>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Learning history</h2>
          <ul className="divide-y text-sm">
            {activities.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span className="truncate">{a.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(a.createdAt, true)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Recent commands</h2>
          <ul className="space-y-1 font-mono text-xs">
            {commands.map((c, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className={`truncate ${c.exitCode ? "text-destructive" : ""}`}>$ {c.command}</span>
                <span className="shrink-0 text-muted-foreground">{timeAgo(c.createdAt)}</span>
              </li>
            ))}
            {!commands.length && <li className="text-muted-foreground">No commands yet.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
