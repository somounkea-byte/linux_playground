import { CheckCircle2, Clock, GraduationCap, SquareTerminal } from "lucide-react";
import Link from "next/link";
import { PageHeader, ProgressBar } from "@/components/app/page-header";
import { MODULE_ICONS } from "@/components/app/nav";
import { requireUser } from "@/server/auth/session";
import { modulesWithProgress } from "@/server/services/learning";

export const metadata = { title: "Learn Linux" };

export default async function LearnPage() {
  const user = await requireUser();
  const modules = await modulesWithProgress(user.studentProfile?.id ?? null);
  const total = modules.reduce((a, m) => a + m.total, 0);
  const done = modules.reduce((a, m) => a + m.completed, 0);
  return (
    <>
      <PageHeader
        icon={<GraduationCap className="size-6 text-primary" />}
        title="Learn Linux"
        description="Eleven modules take you from your first command to securing a server. Each lesson has practice tasks you complete in the terminal."
        actions={
          user.studentProfile && (
            <div className="w-56 rounded-lg border bg-card px-3 py-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Overall progress</span>
                <span>
                  {done}/{total}
                </span>
              </div>
              <ProgressBar value={total ? (done / total) * 100 : 0} />
            </div>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((m, i) => {
          const Icon = MODULE_ICONS[m.slug] ?? SquareTerminal;
          const minutes = m.lessons.reduce((a, l) => a + l.estimatedMinutes, 0);
          const complete = m.total > 0 && m.completed === m.total;
          return (
            <Link key={m.id} href={`/learn/${m.slug}`} className="group flex flex-col rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
              <div className="flex items-start justify-between">
                <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="text-xs font-medium text-muted-foreground">Module {i + 1}</span>
              </div>
              <h2 className="mt-4 font-semibold">{m.title}</h2>
              <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted-foreground">{m.description}</p>
              <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{m.total} lessons</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" /> {minutes} min
                </span>
                {complete && (
                  <span className="ml-auto flex items-center gap-1 font-medium text-success">
                    <CheckCircle2 className="size-3.5" /> Completed
                  </span>
                )}
              </div>
              {user.studentProfile && <ProgressBar value={m.percent} className="mt-3 h-1.5" tone={complete ? "success" : "primary"} />}
            </Link>
          );
        })}
      </div>
    </>
  );
}
