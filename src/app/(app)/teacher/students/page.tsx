import { AlertTriangle, Users } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader, ProgressBar } from "@/components/app/page-header";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { studentRows } from "@/server/services/teacher";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { q = "", filter } = await searchParams;
  let rows = await studentRows(user);
  if (q) rows = rows.filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(q.toLowerCase()));
  if (filter === "support") rows = rows.filter((r) => r.needsSupport);
  return (
    <>
      <PageHeader
        icon={<Users className="size-6 text-primary" />}
        title="Students"
        description={user.teacherProfile ? `Students join your class with invite code ${user.teacherProfile.inviteCode}.` : "All students on the platform."}
        actions={
          <form className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search name or email" className="h-8 rounded-lg border bg-transparent px-2.5 text-sm" />
            <select name="filter" defaultValue={filter ?? ""} className="h-8 rounded-lg border bg-transparent px-2 text-sm">
              <option value="">All students</option>
              <option value="support">Needs support</option>
            </select>
            <button className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Filter</button>
          </form>
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Users />} title="No students found" description="Share your invite code so students can join your class from their Settings page." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Student</th>
                <th className="px-4 py-2.5 text-left font-medium">Level / XP</th>
                <th className="px-4 py-2.5 text-left font-medium">Lessons</th>
                <th className="px-4 py-2.5 text-left font-medium">Challenges</th>
                <th className="px-4 py-2.5 text-left font-medium">Avg quiz</th>
                <th className="px-4 py-2.5 text-left font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-accent/30">
                  <td className="px-4 py-3">
                    <Link href={`/teacher/students/${r.id}`} className="font-medium hover:text-primary">
                      {r.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{r.email}</span>
                    {r.needsSupport && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="size-3" /> {r.reasons[0]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    L{r.level} <span className="text-muted-foreground">· {r.xp} XP</span>
                  </td>
                  <td className="w-40 px-4 py-3">
                    <span className="text-xs">{r.lessonPercent}%</span>
                    <ProgressBar value={r.lessonPercent} className="mt-1 h-1.5" />
                  </td>
                  <td className="px-4 py-3">{r.challengesPassed}</td>
                  <td className={`px-4 py-3 ${r.avgQuiz !== null && r.avgQuiz < 60 ? "text-warning" : ""}`}>{r.avgQuiz === null ? "—" : `${r.avgQuiz}%`}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.lastActive ? timeAgo(r.lastActive) : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
