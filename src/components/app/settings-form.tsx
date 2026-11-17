"use client";

import { Loader2, Moon, RotateCcw, Sun, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mb-4 text-sm text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

export function SettingsForm({ user, isStudent, teacherName, inviteCode }: { user: { name: string; email: string; role: string }; isStudent: boolean; teacherName: string | null; inviteCode: string | null }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(user.name);
  const [code, setCode] = useState("");
  const [font, setFont] = useState(14);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setFont(Number(window.localStorage.getItem("lp-terminal-font-size")) || 14);
  }, []);

  async function save(key: string, payload: Record<string, unknown>, msg: string) {
    setBusy(key);
    try {
      await api("/api/profile", { method: "PATCH", body: payload });
      toast.success(msg);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function resetEnv() {
    if (!window.confirm("Reset your playground? All files, users and packages you created will be lost.")) return;
    setBusy("reset");
    try {
      await api("/api/terminal/reset", { body: { target: { kind: "playground" } } });
      toast.success("Your playground was reset to a fresh Ubuntu machine.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <Card title="Profile" description={`${user.email} · ${user.role.toLowerCase()}`}>
        <Label htmlFor="name">Display name</Label>
        <div className="mt-1.5 flex gap-2">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => save("name", { name }, "Name updated")} disabled={busy === "name" || name.trim().length < 2}>
            {busy === "name" && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </Card>
      <Card title="Appearance" description="The terminal always uses a dark theme.">
        <div className="flex gap-2">
          {[
            ["light", Sun],
            ["dark", Moon],
            ["system", Monitor],
          ].map(([t, Icon]) => {
            const I = Icon as typeof Sun;
            return (
              <button key={t as string} onClick={() => setTheme(t as string)} className={cn("flex flex-1 flex-col items-center gap-1 rounded-lg border p-3 text-sm capitalize", theme === t && "border-primary bg-primary/10")}>
                <I className="size-4" />
                {t as string}
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="Terminal" description="Font size used by every terminal on this device.">
        <div className="flex items-center gap-3">
          <input type="range" min={10} max={24} value={font} onChange={(e) => setFont(Number(e.target.value))} className="flex-1 accent-[var(--primary)]" aria-label="Terminal font size" />
          <span className="w-12 font-mono text-sm">{font}px</span>
          <Button
            variant="outline"
            onClick={() => {
              window.localStorage.setItem("lp-terminal-font-size", String(font));
              if (isStudent) void save("font", { terminalFontSize: font }, "Terminal font saved");
              else toast.success("Terminal font saved");
            }}
          >
            Save
          </Button>
        </div>
        <p className="mt-3 rounded-lg bg-[var(--terminal-bg)] p-3 font-mono text-[#7ee787]" style={{ fontSize: font }}>
          student@linux-playground:~$ ls
        </p>
      </Card>
      {isStudent && (
        <Card title="Class" description={teacherName ? `You are in ${teacherName}'s class.` : "Join your teacher's class with their invite code."}>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="INVITE CODE" className="font-mono uppercase" />
            <Button onClick={() => save("code", { inviteCode: code, name }, "You joined the class")} disabled={!code || busy === "code"}>
              Join
            </Button>
          </div>
          {teacherName && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => save("leave", { leaveClass: true }, "You left the class")}>
              Leave class
            </Button>
          )}
        </Card>
      )}
      {inviteCode && (
        <Card title="Your class invite code" description="Share this code with students so they can join your class in their settings.">
          <p className="rounded-lg border bg-muted/40 p-3 text-center font-mono text-2xl font-bold tracking-widest">{inviteCode}</p>
        </Card>
      )}
      <Card title="Virtual environment" description="Start over with a fresh Ubuntu machine. Challenge machines are separate and can be reset from each challenge.">
        <Button variant="destructive" onClick={resetEnv} disabled={busy === "reset"}>
          {busy === "reset" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset playground
        </Button>
      </Card>
    </div>
  );
}
