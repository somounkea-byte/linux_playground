import { FileStack, Plus } from "lucide-react";
import Link from "next/link";
import { DifficultyBadge } from "@/components/app/icons";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Exercises" };

export default async function ExercisesPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const list = await prisma.exercise.findMany({
    orderBy: [{ kind: "asc" }, { difficulty: "asc" }, { title: "asc" }],
    include: { author: { select: { name: true } }, _count: { select: { tasks: true, submissions: true, assignments: true } } },
  });
  return (
    <>
      <PageHeader
        icon={<FileStack className="size-6 text-primary" />}
        title={user.role === "ADMIN" ? "Exercise Management" : "Exercises"}
        description="Built-in challenges and exercises created by teachers. Tasks are graded automatically against the student's virtual machine."
        actions={
          <Link href="/teacher/exercises/new" className={buttonVariants()}>
            <Plus /> New exercise
          </Link>
        }
      />
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Title</th>
              <th className="px-4 py-2.5 text-left font-medium">Type</th>
              <th className="px-4 py-2.5 text-left font-medium">Difficulty</th>
              <th className="px-4 py-2.5 text-left font-medium">Tasks</th>
              <th className="px-4 py-2.5 text-left font-medium">XP</th>
              <th className="px-4 py-2.5 text-left font-medium">Attempts</th>
              <th className="px-4 py-2.5 text-left font-medium">Author</th>
              <th className="px-4 py-2.5 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const editable = user.role === "ADMIN" || e.authorId === user.id;
              return (
                <tr key={e.id} className="border-t">
                  <td className="px-4 py-3">
                    <Link href={`/challenges/${e.slug}`} className="font-medium hover:text-primary">
                      {e.title}
                    </Link>
                    {!e.isPublished && <span className="ml-2 rounded bg-muted px-1.5 text-xs">draft</span>}
                    <span className="block text-xs text-muted-foreground">{e.category}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{e.kind.toLowerCase()}</td>
                  <td className="px-4 py-3">
                    <DifficultyBadge difficulty={e.difficulty} />
                  </td>
                  <td className="px-4 py-3">{e._count.tasks}</td>
                  <td className="px-4 py-3">{e.xpReward}</td>
                  <td className="px-4 py-3">{e._count.submissions}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{e.author?.name ?? "Linux Playground"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/teacher/exercises/${e.id}`} className="text-primary hover:underline">
                      {editable ? "Edit" : "View"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
