import { ArrowRight, CheckCircle2, Circle, Clock, ListChecks, SquareTerminal, Swords } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressBar } from "@/components/app/page-header";
import { DifficultyBadge } from "@/components/app/icons";
import { MODULE_ICONS } from "@/components/app/nav";
import { ModuleLab } from "@/components/learn/module-lab";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { modulesWithProgress } from "@/server/services/learning";

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const m = await prisma.learningModule.findUnique({ where: { slug: module }, select: { title: true } });
  return { title: m?.title ?? "Module" };
}

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const user = await requireUser();
  const modules = await modulesWithProgress(user.studentProfile?.id ?? null);
  const idx = modules.findIndex((m) => m.slug === slug);
  if (idx === -1) notFound();
  const m = modules[idx];
  const [challenges, quiz] = await Promise.all([
    prisma.exercise.findMany({ where: { category: slug, isPublished: true, kind: "CHALLENGE" }, orderBy: { difficulty: "asc" }, select: { slug: true, title: true, difficulty: true, summary: true, xpReward: true } }),
    prisma.quiz.findFirst({ where: { moduleId: m.id, isPublished: true }, select: { slug: true, title: true, _count: { select: { questions: true } } } }),
  ]);
  const Icon = MODULE_ICONS[m.slug] ?? SquareTerminal;
  const next = m.lessons.find((l) => !l.done) ?? m.lessons[0];
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 rounded-2xl border bg-card p-6 lg:flex-row lg:items-center">
        <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Module {idx + 1} of {modules.length}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{m.description}</p>
        </div>
        <div className="w-full shrink-0 lg:w-64">
          {user.studentProfile && (
            <>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>
                  {m.completed} of {m.total} lessons
                </span>
                <span>{m.percent}%</span>
              </div>
              <ProgressBar value={m.percent} tone={m.percent === 100 ? "success" : "primary"} />
            </>
          )}
          {next && (
            <Link href={`/learn/${m.slug}/${next.slug}`} className={cn(buttonVariants(), "mt-3 w-full")}>
              {m.completed === 0 ? "Start module" : m.completed === m.total ? "Review lessons" : "Continue"} <ArrowRight />
            </Link>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Lessons</h2>
          <ol className="space-y-2">
            {m.lessons.map((l, i) => (
              <li key={l.id}>
                <Link href={`/learn/${m.slug}/${l.slug}`} className="flex items-center gap-3 rounded-lg border bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-accent/30">
                  {l.done ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className="size-5 shrink-0 text-muted-foreground/50" />}
                  <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{l.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {l.estimatedMinutes} min
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
        <aside className="space-y-4">
          {quiz && (
            <Link href={`/quizzes/${quiz.slug}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary/40">
              <ListChecks className="size-6 text-primary" />
              <span className="min-w-0">
                <span className="block font-medium">{quiz.title}</span>
                <span className="text-xs text-muted-foreground">{quiz._count.questions} questions · test your knowledge</span>
              </span>
            </Link>
          )}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <Swords className="size-4 text-primary" /> Related challenges
            </h3>
            {challenges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No challenges for this module yet.</p>
            ) : (
              <ul className="space-y-2">
                {challenges.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/challenges/${c.slug}`} className="block rounded-lg border p-3 hover:bg-accent/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.title}</span>
                        <DifficultyBadge difficulty={c.difficulty} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.summary}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <ModuleLab moduleSlug={m.slug} />
    </div>
  );
}
