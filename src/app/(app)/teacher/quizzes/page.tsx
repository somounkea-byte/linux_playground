import { ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Manage quizzes" };

export default async function TeacherQuizzesPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const quizzes = await prisma.quiz.findMany({ include: { module: { select: { title: true } }, author: { select: { name: true } }, _count: { select: { questions: true, attempts: true } } }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader
        icon={<ListChecks className="size-6 text-primary" />}
        title="Quizzes"
        description="Create quizzes with multiple choice, true/false, fill-in, matching, permission, predict-the-output and practical terminal questions."
        actions={
          <Link href="/teacher/quizzes/new" className={buttonVariants()}>
            <Plus /> New quiz
          </Link>
        }
      />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {["Quiz", "Module", "Questions", "Attempts", "Pass mark", "Author", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quizzes.map((q) => (
              <tr key={q.id} className="border-t">
                <td className="px-4 py-3 font-medium">
                  {q.title}
                  {!q.isPublished && <span className="ml-2 rounded bg-muted px-1.5 text-xs">draft</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{q.module?.title ?? "—"}</td>
                <td className="px-4 py-3">{q._count.questions}</td>
                <td className="px-4 py-3">{q._count.attempts}</td>
                <td className="px-4 py-3">{q.passingScore}%</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{q.author?.name ?? "Linux Playground"}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/teacher/quizzes/${q.id}`} className="text-primary hover:underline">
                    {user.role === "ADMIN" || q.authorId === user.id ? "Edit" : "View"}
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
