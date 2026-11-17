"use client";

import { Bell, LogOut, Menu, Moon, Settings, Sparkles, Sun, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api-client";
import { SidebarNav } from "./sidebar";

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      {mounted && resolvedTheme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const unread = items.filter((n) => !n.readAt).length;
  const load = useCallback(() => {
    api<Notification[]>("/api/notifications")
      .then(setItems)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  async function open(n: Notification) {
    if (!n.readAt) await api(`/api/notifications`, { method: "PATCH", body: { ids: [n.id] } }).catch(() => {});
    load();
    if (n.link) router.push(n.link);
  }
  return (
    <DropdownMenu onOpenChange={(o) => o && load()}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Notifications" className="relative" />}>
        <Bell />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-bold text-primary-foreground">{unread}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={() => api("/api/notifications", { method: "PATCH", body: { all: true } }).then(load)}>
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">You are all caught up.</p>}
        {items.slice(0, 8).map((n) => (
          <DropdownMenuItem key={n.id} onClick={() => open(n)} className="flex flex-col items-start gap-0.5 py-2">
            <span className="flex w-full items-center gap-2 text-sm font-medium">
              {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
              {n.title}
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ user }: { user: { name: string; email: string; role: string; xp?: number; level?: number } }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
        <Menu />
      </Button>
      <Link href="/dashboard" className="lg:hidden">
        <Logo className="text-sm" />
      </Link>
      <div className="flex-1" />
      {user.role === "STUDENT" && user.level !== undefined && (
        <Link href="/progress" className="hidden items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium sm:flex">
          <Sparkles className="size-3.5 text-primary" />
          Level {user.level}
          <span className="text-muted-foreground">· {user.xp} XP</span>
        </Link>
      )}
      <ThemeToggle />
      <Notifications />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Account menu" />}>
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm md:inline">{user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-primary">{user.role.toLowerCase()}</p>
          </div>
          <DropdownMenuSeparator />
          {user.role === "STUDENT" && (
            <DropdownMenuItem onClick={() => router.push("/progress")}>
              <User /> My progress
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <Settings /> Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout} variant="destructive">
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-0">
          <SheetTitle className="flex h-14 items-center px-5">
            <Logo />
          </SheetTitle>
          <SidebarNav role={user.role} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
