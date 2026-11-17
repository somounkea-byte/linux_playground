import { ArrowRight, Award, BookOpen, CheckCircle2, ClipboardCheck, ShieldCheck, SquareTerminal, Swords, Users } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser, homeFor } from "@/server/auth/session";

const FEATURES = [
  { icon: SquareTerminal, title: "A real-feeling Ubuntu terminal", text: "Every student gets a persistent virtual machine with a bash-compatible shell, 170+ commands, pipes, redirection and scripting." },
  { icon: ShieldCheck, title: "Permissions that actually apply", text: "chmod, chown, sudo, users and groups change the system – and the system enforces them. Permission denied means something." },
  { icon: Swords, title: "Hands-on challenges", text: "Realistic sysadmin scenarios graded on the final state of your machine, so every valid solution counts." },
  { icon: BookOpen, title: "11 structured modules", text: "From the basics to networking, packages, storage, scripting and security, with practice tasks verified automatically." },
  { icon: Award, title: "XP, levels and badges", text: "Streaks, achievements and progress tracking keep learners motivated." },
  { icon: Users, title: "Built for classrooms", text: "Teachers create exercises, assign them with deadlines, review submissions and export reports." },
];

export default async function Home() {
  const user = await getCurrentUser();
  const cta = user ? homeFor(user.role) : "/register";
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href={homeFor(user.role)} className={buttonVariants()}>
              Open dashboard <ArrowRight />
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
                Sign in
              </Link>
              <Link href="/register" className={buttonVariants()}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-2 lg:pt-16">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" /> Ubuntu 24.04 simulator · nothing to install
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Learn Linux <span className="text-primary">by doing.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Linux Playground gives every IT student their own Ubuntu machine in the browser. Practise commands, manage users and permissions, run services and solve real administration challenges – safely.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={cta} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}>
              {user ? "Continue learning" : "Start learning free"} <ArrowRight />
            </Link>
            <Link href="/login" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-5")}>
              I have an account
            </Link>
          </div>
          <ul className="mt-8 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {["54 lessons with auto-checked practice", "15 graded admin challenges", "Quizzes with practical tasks", "Teacher dashboard & reports"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-success" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div className="absolute -inset-4 rounded-3xl bg-[radial-gradient(circle_at_30%_20%,rgba(233,84,32,0.25),transparent_55%)] blur-2xl" />
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[var(--terminal-bg)] font-mono text-[0.8rem] shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#11161d] px-4 py-2.5">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#febc2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-xs text-white/50">student@linux-playground: ~/projects</span>
            </div>
            <pre className="overflow-x-auto p-5 leading-6 text-[#d7dde6]">
              <P path="~/projects" />./hello.sh{"\n"}
              bash: ./hello.sh: Permission denied{"\n"}
              <P path="~/projects" />chmod +x hello.sh && ./hello.sh{"\n"}
              Hello from Linux Playground!{"\n"}
              <P path="~/projects" />sudo apt install -y nginx{"\n"}
              <span className="text-white/50">Setting up nginx (1.24.0-2ubuntu7) ...</span>
              {"\n"}
              <P path="~/projects" />curl -s localhost | grep h1{"\n"}
              {"<h1>Welcome to nginx!</h1>"}
              {"\n"}
              <P path="~/projects" />
              <span className="animate-pulse">▋</span>
            </pre>
          </div>
        </div>
      </section>

      <section className="border-t bg-card/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-background p-5">
              <f.icon className="mb-3 size-6 text-primary" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16 text-center">
        <ClipboardCheck className="mx-auto mb-3 size-8 text-primary" />
        <h2 className="text-2xl font-semibold">Ready to open your terminal?</h2>
        <p className="mt-2 text-muted-foreground">Create an account and your Ubuntu machine is ready in seconds.</p>
        <Link href={cta} className={cn(buttonVariants({ size: "lg" }), "mt-6 h-11 px-6")}>
          {user ? "Go to dashboard" : "Create free account"} <ArrowRight />
        </Link>
      </section>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">Linux Playground · Learn Linux by Doing</footer>
    </div>
  );
}

function P({ path }: { path: string }) {
  return (
    <>
      <span className="text-[#7ee787]">student@linux-playground</span>:<span className="text-[#79c0ff]">{path}</span>${" "}
    </>
  );
}
