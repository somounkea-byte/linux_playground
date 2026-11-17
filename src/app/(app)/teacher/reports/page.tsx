import { BarChart3, Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { SimpleBarChart } from "@/components/charts/xp-chart";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/server/auth/session";
import { exercisePerformance, moduleCompletion, quizPerformance, studentRows } from "@/server/services/teacher";

export const metadata = { title: "Reports" };

function Csv({ report }: { report: string }) {
  return (
    <a href={`/api/teacher/reports?report=${report}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
      <Download /> CSV
    </a>
  );
}

export default async function ReportsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const rows = await studentRows(user);
  const ids = rows.map((r) => r.id);
  const [modules, exercises, quizzes] = await Promise.all([moduleCompletion(ids), exercisePerformance(ids), quizPerformance(ids)]);
  return (
    <>
      <PageHeader icon={<BarChart3 className="size-6 text-primary" />} title="Reports" description="Class performance by student, module, exercise and quiz. Every table can be exported as CSV." />
      <div className="space-y-6">
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Individual student progress</h2>
            <Csv report="students" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  {["Student", "Level", "XP", "Lessons", "Progress", "Challenges", "Avg quiz", "Streak"].map((h) => (
                    <th key={h} className="py-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.name}</td>
                    <td>{r.level}</td>
                    <td>{r.xp}</td>
                    <td>{r.lessonsDone}</td>
                    <td>{r.lessonPercent}%</td>
                    <td>{r.challengesPassed}</td>
                    <td>{r.avgQuiz ?? "—"}</td>
                    <td>{r.streak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Module performance (completion %)</h2>
              <Csv report="modules" />
            </div>
            <SimpleBarChart data={modules} xKey="title" yKey="completion" label="Completion %" />
          </section>
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Quiz performance (avg %)</h2>
              <Csv report="quizzes" />
            </div>
            <SimpleBarChart data={quizzes} xKey="title" yKey="avgScore" label="Average %" color="var(--chart-3)" />
          </section>
        </div>
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Exercise performance</h2>
            <Csv report="exercises" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  {["Exercise", "Difficulty", "Attempted", "Passed", "Pass rate", "Avg score", "Avg checks", "Avg hints"].map((h) => (
                    <th key={h} className="py-2 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exercises.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-2">{e.title}</td>
                    <td className="text-xs">{e.difficulty.toLowerCase()}</td>
                    <td>{e.attempted}</td>
                    <td>{e.passed}</td>
                    <td>{e.passRate}%</td>
                    <td>{e.avgScore}%</td>
                    <td>{e.avgChecks}</td>
                    <td>{e.avgHints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
