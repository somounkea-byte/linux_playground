import { ChevronRight, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChallengeWorkspace } from "@/components/challenges/challenge-workspace";
import { DifficultyBadge } from "@/components/app/icons";
import { Markdown } from "@/components/markdown";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { HINT_THRESHOLD_FOR_SOLUTION, startChallenge } from "@/server/services/challenges";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await prisma.exercise.findUnique({ where: { slug }, select: { title: true } });
  return { title: e?.title ?? "Challenge" };
}

export default async function ChallengePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const ex = await prisma.exercise.findUnique({ where: { slug }, include: { tasks: { orderBy: { order: "asc" } } } });
  if (!ex || (!ex.isPublished && user.role === "STUDENT")) notFound();
  await startChallenge(user, slug);
  const sub = user.studentProfile ? await prisma.exerciseSubmission.findUnique({ where: { exerciseId_studentId: { exerciseId: ex.id, studentId: user.studentProfile.id } } }) : null;
  const assignment = user.studentProfile ? await prisma.assignment.findFirst({ where: { exerciseId: ex.id, students: { some: { studentId: user.studentProfile.id } } } }) : null;
  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/challenges" className="hover:text-foreground">
          Challenges
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{ex.title}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{ex.title}</h1>
        <DifficultyBadge difficulty={ex.difficulty} />
        <span className="flex items-center gap-1 text-sm font-medium text-primary">
          <Sparkles className="size-4" /> {assignment?.xpReward ?? ex.xpReward} XP
        </span>
        {assignment?.dueAt && <span className="rounded-full border px-2.5 py-0.5 text-xs">Assignment due {assignment.dueAt.toUTCString().slice(0, 16)}</span>}
      </div>
      <ChallengeWorkspace
        slug={ex.slug}
        tasks={ex.tasks.map((t) => ({ id: t.id, description: t.description }))}
        hintsCount={ex.hints.length}
        initialResults={(sub?.results as never[]) ?? []}
        initialHints={ex.hints.slice(0, sub?.hintsUsed ?? 0)}
        passed={sub?.status === "PASSED"}
        attempts={sub?.attempts ?? 0}
        solutionThreshold={HINT_THRESHOLD_FOR_SOLUTION}
        instructions={
          <div className="space-y-4">
            <div className="rounded-lg border-l-4 border-primary bg-primary/5 p-3 text-sm">
              <p className="mb-1 font-semibold">Scenario</p>
              {ex.scenario}
            </div>
            {ex.objectives.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                  <Target className="size-4 text-primary" /> Learning objectives
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                  {ex.objectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="mb-1 text-sm font-semibold">Instructions</p>
              <Markdown>{ex.instructions}</Markdown>
            </div>
            <p className="text-xs text-muted-foreground">This challenge has its own machine – your playground is untouched. Password for sudo: student.</p>
            {assignment?.instructions && <p className="rounded-lg border bg-muted/40 p-3 text-sm">Teacher note: {assignment.instructions}</p>}
          </div>
        }
      />
    </div>
  );
}
