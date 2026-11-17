import { AlertTriangle, BarChart3, BookOpenCheck, ListChecks, Swords, Users, UserCheck } from "lucide-react";
import Link from "next/link";
import { PageHeader, ProgressBar, StatCard } from "@/components/app/page-header";
import { SimpleBarChart } from "@/components/charts/xp-chart";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { teacherOverview } from "@/server/services/teacher";

export const metadata = { title: "Teacher Dashboard" };

export default async function TeacherDashboard() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const o = await teacherOverview(user);
  return (
    <>
      <PageHeader
        icon={<BarChart3 className="size-6 text-primary" />}
        title="Teacher Dashboard"
        description={user.role === "ADMIN" ? "Platform-wide view of every student." : `Your class${user.teacherProfile ? ` · invite code ${user.teacherProfile.inviteCode}` : ""}`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Total students" value={o.total} icon={<Users />} />
        <StatCard label="Active (7 days)" value={o.active} icon={<UserCheck />} hint={o.total ? `${Math.round((o.active / o.total) * 100)}% of class` : undefined} />
        <StatCard label="Module completion" value={`${o.moduleCompletion}%`} icon={<BookOpenCheck />} />
        <StatCard label="Average quiz score" value={o.avgQuiz === null ? "—" : `${o.avgQuiz}%`} icon={<ListChecks />} />
        <StatCard label="Challenge completion" value={`${o.challengeCompletion}%`} icon={<Swords />} />
        <StatCard label="Need support" value={o.needSupport.length} icon={<AlertTriangle />} className={o.needSupport.length ? "border-warning/40" : ""} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Module completion</h2>
          <SimpleBarChart data={o.modules} xKey="title" yKey="completion" label="Completion %" />
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-warning" /> Students needing support
          </h2>
          {o.needSupport.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone is on track. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {o.needSupport.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <Link href={`/teacher/students/${s.id}`} className="block rounded-lg border p-2.5 hover:bg-accent/40">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-warning">{s.reasons.join(" · ")}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Exercise performance</h2>
          <div className="space-y-2.5">
            {o.exercises
              .filter((e) => e.attempted > 0)
              .slice(0, 10)
              .map((e) => (
                <div key={e.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="truncate">{e.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {e.passed}/{e.attempted} passed · {e.avgChecks} checks avg
                    </span>
                  </div>
                  <ProgressBar value={e.passRate} className="h-1.5" tone={e.passRate >= 70 ? "success" : e.passRate >= 40 ? "warning" : "primary"} />
                </div>
              ))}
            {!o.exercises.some((e) => e.attempted) && <p className="text-sm text-muted-foreground">No attempts yet.</p>}
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Recent activity</h2>
          <ul className="space-y-2 text-sm">
            {o.recent.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.student.user.name}</span> <span className="text-muted-foreground">{a.title.charAt(0).toLowerCase() + a.title.slice(1)}</span>
                <span className="block text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
