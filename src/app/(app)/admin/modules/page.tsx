import { Layers } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { NewModuleButton } from "@/components/admin/content-admin";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Module Management" };

export default async function AdminModulesPage() {
  await requireUser(["ADMIN"]);
  const modules = await prisma.learningModule.findMany({ orderBy: { order: "asc" }, include: { _count: { select: { lessons: true, quizzes: true } } } });
  return (
    <>
      <PageHeader icon={<Layers className="size-6 text-primary" />} title="Module Management" description="Edit learning modules, lessons, practice commands and auto-checked tasks." actions={<NewModuleButton />} />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {["#", "Module", "Lessons", "Quizzes", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-4 py-3 text-muted-foreground">{m.order}</td>
                <td className="px-4 py-3">
                  <span className="font-medium">{m.title}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{m.slug}</span>
                </td>
                <td className="px-4 py-3">{m._count.lessons}</td>
                <td className="px-4 py-3">{m._count.quizzes}</td>
                <td className={`px-4 py-3 text-xs ${m.isPublished ? "text-success" : "text-muted-foreground"}`}>{m.isPublished ? "published" : "hidden"}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/modules/${m.id}`} className="text-primary hover:underline">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
