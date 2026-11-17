import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { ModuleEditor } from "@/components/admin/content-admin";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Edit module" };

export default async function AdminModuleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser(["ADMIN"]);
  const m = await prisma.learningModule.findUnique({ where: { id }, include: { lessons: { orderBy: { order: "asc" } } } });
  if (!m) notFound();
  return (
    <>
      <PageHeader title={m.title} description="Changes are visible to students immediately." />
      <ModuleEditor
        module={{ id: m.id, title: m.title, description: m.description, icon: m.icon, isPublished: m.isPublished, order: m.order, slug: m.slug }}
        lessons={m.lessons.map((l) => ({ id: l.id, slug: l.slug, title: l.title, summary: l.summary, content: l.content, practice: l.practice, checks: l.checks, xpReward: l.xpReward, estimatedMinutes: l.estimatedMinutes, isPublished: l.isPublished, order: l.order }))}
      />
    </>
  );
}
