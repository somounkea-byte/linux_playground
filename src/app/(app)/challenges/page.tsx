import { CheckCircle2, CircleDashed, Sparkles, Swords, XCircle } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { DifficultyBadge } from "@/components/app/icons";
import { requireUser } from "@/server/auth/session";
import { challengeList } from "@/server/services/challenges";

export const metadata = { title: "Practice Challenges" };

const LEVELS = [
  { key: "BEGINNER", title: "Beginner", text: "Basic commands, creating files and navigating." },
  { key: "INTERMEDIATE", title: "Intermediate", text: "Permissions, users and groups, combining commands." },
  { key: "ADVANCED", title: "Advanced", text: "Complete administration tasks and troubleshooting." },
];

export default async function ChallengesPage() {
  const user = await requireUser();
  const list = await challengeList(user.studentProfile?.id ?? null);
  const solved = list.filter((c) => c.submission?.status === "PASSED").length;
  return (
    <>
      <PageHeader
        icon={<Swords className="size-6 text-primary" />}
        title="Practice Challenges"
        description="Real-world administration scenarios. Each challenge runs on its own fresh machine and is graded on the final state – any valid solution counts."
        actions={user.studentProfile && <span className="rounded-full border bg-card px-3 py-1 text-sm">{solved} / {list.length} solved</span>}
      />
      <div className="space-y-8">
        {LEVELS.map((lvl) => (
          <section key={lvl.key}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">{lvl.title}</h2>
              <p className="text-sm text-muted-foreground">{lvl.text}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list
                .filter((c) => c.difficulty === lvl.key)
                .map((c) => {
                  const status = c.submission?.status;
                  return (
                    <Link key={c.id} href={`/challenges/${c.slug}`} className="group flex flex-col rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{c.title}</h3>
                        {status === "PASSED" ? (
                          <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Solved" />
                        ) : status === "FAILED" ? (
                          <XCircle className="size-5 shrink-0 text-warning" aria-label="Attempted" />
                        ) : status === "IN_PROGRESS" ? (
                          <CircleDashed className="size-5 shrink-0 text-info" aria-label="Started" />
                        ) : null}
                      </div>
                      <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.summary}</p>
                      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                        <DifficultyBadge difficulty={c.difficulty} />
                        <span>{c._count.tasks} tasks</span>
                        <span className="ml-auto flex items-center gap-1 font-medium text-primary">
                          <Sparkles className="size-3.5" /> {c.xpReward} XP
                        </span>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
