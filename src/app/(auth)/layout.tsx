import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { getCurrentUser, homeFor } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </div>
      <div className="relative hidden overflow-hidden bg-[var(--terminal-bg)] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(233,84,32,0.18),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(126,231,135,0.12),transparent_40%)]" />
        <div className="relative flex h-full items-center justify-center p-12">
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-black/40 font-mono text-sm shadow-2xl">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#febc2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-xs text-white/50">student@linux-playground: ~</span>
            </div>
            <pre className="whitespace-pre-wrap p-5 leading-6 text-[#d7dde6]">
              <span className="text-[#7ee787]">student@linux-playground</span>:<span className="text-[#79c0ff]">~</span>$ whoami{"\n"}student{"\n"}
              <span className="text-[#7ee787]">student@linux-playground</span>:<span className="text-[#79c0ff]">~</span>$ sudo useradd -m john{"\n"}[sudo] password for student:{"\n"}
              <span className="text-[#7ee787]">student@linux-playground</span>:<span className="text-[#79c0ff]">~</span>$ chmod 770 /var/www/project{"\n"}
              <span className="text-[#7ee787]">student@linux-playground</span>:<span className="text-[#79c0ff]">~</span>$ ls -ld /var/www/project{"\n"}drwxrwx--- 2 root developers 4096 Nov 12 08:30 <span className="text-[#79c0ff]">/var/www/project</span>
              {"\n"}
              <span className="text-[#7ee787]">student@linux-playground</span>:<span className="text-[#79c0ff]">~</span>$ <span className="animate-pulse">▋</span>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
