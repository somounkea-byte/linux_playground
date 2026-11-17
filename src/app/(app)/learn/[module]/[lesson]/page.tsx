import { ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonView } from "@/components/learn/lesson-view";
import { Markdown } from "@/components/markdown";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { markLessonStarted } from "@/server/services/learning";

export async function generateMetadata({ params }: { params: Promise<{ module: string; lesson: string }> }) {
  const { module, lesson } = await params;
  const l = await prisma.lesson.findFirst({ where: { slug: lesson, module: { slug: module } }, select: { title: true } });
  return { title: l?.title ?? "Lesson" };
}

export default async function LessonPage({ params }: { params: Promise<{ module: string; lesson: string }> }) {
  const { module: moduleSlug, lesson: lessonSlug } = await params;
  const user = await requireUser();
  const mod = await prisma.learningModule.findUnique({
    where: { slug: moduleSlug },
    include: { lessons: { where: { isPublished: true }, orderBy: { order: "asc" } } },
  });
  if (!mod || !mod.isPublished) notFound();
  const idx = mod.lessons.findIndex((l) => l.slug === lessonSlug);
  if (idx === -1) notFound();
  const lesson = mod.lessons[idx];
  const profile = user.studentProfile;
  let done = false;
  if (profile) {
    await markLessonStarted(profile.id, lesson.id);
    done = (await prisma.studentProgress.findUnique({ where: { studentId_lessonId: { studentId: profile.id, lessonId: lesson.id } } }))?.status === "COMPLETED";
  }
  const prevLesson = mod.lessons[idx - 1];
  const nextLesson = mod.lessons[idx + 1];
  let next: string | null = nextLesson ? `/learn/${mod.slug}/${nextLesson.slug}` : null;
  if (!next) {
    const nextModule = await prisma.learningModule.findFirst({ where: { order: { gt: mod.order }, isPublished: true }, orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" }, take: 1 } } });
    if (nextModule?.lessons[0]) next = `/learn/${nextModule.slug}/${nextModule.lessons[0].slug}`;
  }
  const practice = (lesson.practice as { command: string; explanation: string }[]) ?? [];
  const checks = (lesson.checks as unknown[]) ?? [];
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href="/learn" className="hover:text-foreground">
          Learn
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/learn/${mod.slug}`} className="hover:text-foreground">
          {mod.title}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">
          Lesson {idx + 1} of {mod.lessons.length}
        </span>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{lesson.title}</h1>
        <p className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
          {lesson.summary}
          <span className="flex shrink-0 items-center gap-1">
            <Clock className="size-3.5" /> {lesson.estimatedMinutes} min
          </span>
        </p>
      </div>
      <LessonView
        lesson={{ id: lesson.id, title: lesson.title, xpReward: lesson.xpReward }}
        content={<Markdown>{lesson.content}</Markdown>}
        practice={practice}
        hasChecks={checks.length > 0}
        done={done}
        isStudent={!!profile}
        prev={prevLesson ? `/learn/${mod.slug}/${prevLesson.slug}` : null}
        next={next}
        moduleHref={`/learn/${mod.slug}`}
      />
    </div>
  );
}
