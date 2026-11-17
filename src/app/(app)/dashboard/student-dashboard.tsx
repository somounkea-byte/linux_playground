import { ArrowRight, BookOpenCheck, CalendarClock, Flame, ListChecks, Sparkles, SquareTerminal, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { ProgressBar, StatCard } from "@/components/app/page-header";
import { BadgeIcon, DifficultyBadge } from "@/components/app/icons";
import { MODULE_ICONS } from "@/components/app/nav";
import { buttonVariants } from "@/components/ui/button";
import { levelProgress, levelTitle } from "@/lib/gamification";
import { cn } from "@/lib/utils";
import type { AuthUser } from "@/server/auth/session";
import { studentDashboard } from "@/server/services/student";
import { timeAgo } from "@/lib/format";

export async function StudentDashboard({ user }: { user: AuthUser }) {
  const d = await studentDashboard(user.studentProfile!.id);
  const lp = levelProgress(d.profile.xp);
  const firstName = user.name.split(" ")[0];
  const hour = new Date().getUTCHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/15 via-card to-card p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{greeting},</p>
            <h1 className="text-2xl font-semibold tracking-tight">{firstName} 👋</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Level {lp.level} · <span className="font-medium text-foreground">{levelTitle(lp.level)}</span>
            </p>
            <div className="mt-4 max-w-sm">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>{d.profile.xp} XP</span>
                <span>
                  {lp.needed - lp.into} XP to level {lp.level + 1}
                </span>
              </div>
              <ProgressBar value={lp.percent} />
            </div>
          </div>
          {d.recommended ? (
            <div className="rounded-xl border bg-background/70 p-4 md:w-96">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">Recommended next</p>
              <p className="mt-1 font-semibold">{d.recommended.lesson.title}</p>
              <p className="text-sm text-muted-foreground">
                {d.recommended.module.title} · {d.recommended.lesson.estimatedMinutes} min
              </p>
              <Link href={`/learn/${d.recommended.module.slug}/${d.recommended.lesson.slug}`} className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
                Continue learning <ArrowRight />
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border bg-background/70 p-4 md:w-96">
              <p className="font-semibold">You completed every lesson! 🎉</p>
              <Link href="/challenges" className={cn(buttonVariants({ size: "sm" }), "mt-3")}>
                Take on challenges <ArrowRight />
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total XP" value={d.profile.xp} icon={<Sparkles />} hint={`Rank #${d.rank} overall`} />
        <StatCard label="Current level" value={lp.level} icon={<Trophy />} hint={levelTitle(lp.level)} />
        <StatCard label="Modules completed" value={`${d.modulesCompleted}/${d.modules.length}`} icon={<BookOpenCheck />} />
        <StatCard label="Challenges solved" value={`${d.challengesPassed}/${d.totalChallenges}`} icon={<Swords />} />
        <StatCard label="Learning streak" value={`${d.profile.currentStreak} day${d.profile.currentStreak === 1 ? "" : "s"}`} icon={<Flame />} hint={`Best: ${d.profile.longestStreak}`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Learning progress</h2>
            <Link href="/learn" className="text-sm text-primary hover:underline">
              All modules
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {d.modules.map((m) => {
              const Icon = MODULE_ICONS[m.slug] ?? SquareTerminal;
              return (
                <Link key={m.id} href={`/learn/${m.slug}`} className="group rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
                  <div className="flex items-center gap-2.5">
                    <Icon className="size-4 text-primary" />
                    <span className="truncate text-sm font-medium">{m.title}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {m.completed}/{m.total}
                    </span>
                  </div>
                  <ProgressBar value={m.percent} className="mt-2.5 h-1.5" tone={m.percent === 100 ? "success" : "primary"} />
                </Link>
              );
            })}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <CalendarClock className="size-4 text-primary" /> Assignments
            </h2>
            {d.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assignments right now.</p>
            ) : (
              <ul className="space-y-2.5">
                {d.assignments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/challenges/${a.exercise.slug}`} className="block rounded-lg border p-3 hover:bg-accent/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{a.title}</span>
                        {a.done ? <span className="text-xs font-medium text-success">Done</span> : <DifficultyBadge difficulty={a.exercise.difficulty} />}
                      </div>
                      {a.dueAt && <p className={cn("mt-1 text-xs", !a.done && a.dueAt < new Date() ? "text-destructive" : "text-muted-foreground")}>Due {a.dueAt.toUTCString().slice(0, 16)}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Badges</h2>
              <Link href="/achievements" className="text-sm text-primary hover:underline">
                View all
              </Link>
            </div>
            {d.badges.length === 0 ? (
              <p className="text-sm text-muted-foreground">Complete your first lesson to earn the Linux Beginner badge.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {d.badges.slice(0, 8).map((b) => (
                  <span key={b.id} title={`${b.badge.name}: ${b.badge.description}`}>
                    <BadgeIcon icon={b.badge.icon} />
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Recent activity</h2>
          {d.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Your activity will appear here. Start with the terminal!</p>
          ) : (
            <ul className="divide-y">
              {d.activities.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="truncate">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="grid gap-3">
          <Link href="/terminal" className="flex items-center gap-3 rounded-xl border bg-[var(--terminal-bg)] p-4 text-[#d7dde6] transition-transform hover:-translate-y-0.5">
            <SquareTerminal className="size-8 text-[#7ee787]" />
            <span>
              <span className="block font-semibold">Open terminal</span>
              <span className="text-xs text-white/60">Your Ubuntu machine is waiting</span>
            </span>
          </Link>
          <Link href="/challenges" className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-transform hover:-translate-y-0.5">
            <Swords className="size-8 text-primary" />
            <span>
              <span className="block font-semibold">Practice challenges</span>
              <span className="text-xs text-muted-foreground">Real sysadmin scenarios</span>
            </span>
          </Link>
          <Link href="/quizzes" className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-transform hover:-translate-y-0.5">
            <ListChecks className="size-8 text-primary" />
            <span>
              <span className="block font-semibold">Quizzes</span>
              <span className="text-xs text-muted-foreground">{d.quizzesPassed} passed so far</span>
            </span>
          </Link>
        </section>
      </div>
    </div>
  );
}
