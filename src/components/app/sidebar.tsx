"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand";
import { cn } from "@/lib/utils";
import { navFor } from "./nav";

export function SidebarNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = navFor(role);
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (!pathname.startsWith(href + "/")) return false;
    // prefer the most specific matching item
    return !allHrefs.some((h) => h !== href && h.startsWith(href + "/") && (pathname === h || pathname.startsWith(h + "/")));
  };
  return (
    <nav className="flex flex-col gap-5 px-3 pb-6">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-1.5 px-3 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">{section.title}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href + item.label}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                      active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ role }: { role: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-14 items-center px-5">
        <Link href="/dashboard" aria-label="Linux Playground home">
          <Logo />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto pt-2">
        <SidebarNav role={role} />
      </div>
    </aside>
  );
}
