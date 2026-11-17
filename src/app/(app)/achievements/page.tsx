import { Award, Lock } from "lucide-react";
import { BadgeIcon } from "@/components/app/icons";
import { PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Achievements" };

export default async function AchievementsPage() {
  const user = await requireUser();
  const sid = user.studentProfile?.id;
  const [badges, earned, leaderboard] = await Promise.all([
    prisma.badge.findMany({ orderBy: { order: "asc" } }),
    sid ? prisma.studentBadge.findMany({ where: { studentId: sid } }) : [],
    prisma.studentProfile.findMany({ orderBy: { xp: "desc" }, take: 10, include: { user: { select: { name: true } } } }),
  ]);
  const map = new Map(earned.map((e) => [e.badgeId, e.earnedAt]));
  return (
    <>
      <PageHeader icon={<Award className="size-6 text-primary" />} title="Achievements" description={sid ? `${earned.length} of ${badges.length} badges earned.` : "Badges students can earn."} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {badges.map((b) => {
            const at = map.get(b.id);
            return (
              <div key={b.id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-4", !at && "opacity-70")}>
                <BadgeIcon icon={b.icon} earned={!!at} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {b.name} {!at && <Lock className="size-3.5 text-muted-foreground" />}
                  </p>
                  <p className="text-sm text-muted-foreground">{b.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{at ? `Earned ${formatDate(at)}` : b.xpBonus ? `+${b.xpBonus} XP bonus` : "Locked"}</p>
                </div>
              </div>
            );
          })}
        </div>
        <section className="h-fit rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">Leaderboard</h2>
          <ol className="space-y-1.5">
            {leaderboard.map((p, i) => (
              <li key={p.id} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm", p.id === sid && "bg-primary/10")}>
                <span className="w-5 text-right font-mono text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate">{p.user.name}</span>
                <span className="font-mono text-xs">{p.xp} XP</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
