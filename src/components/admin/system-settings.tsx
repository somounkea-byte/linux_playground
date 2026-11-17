"use client";

import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";

export function SystemSettingsForm({
  initial,
  env,
}: {
  initial: { registrationOpen: boolean; maintenanceMessage: string; defaultTerminalFontSize: number };
  env: { authProvider: string; localAuth: boolean; redis: boolean; nodeEnv: string; appUrl: string; terminalRate: number; adminEmails: string };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/settings", { method: "PATCH", body: v });
      toast.success("Settings saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-2">
      <section className="space-y-5 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Platform</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>Open registration</Label>
            <p className="text-xs text-muted-foreground">Allow new students to create accounts themselves.</p>
          </div>
          <Switch checked={v.registrationOpen} onCheckedChange={(c) => setV({ ...v, registrationOpen: !!c })} />
        </div>
        <div className="space-y-1.5">
          <Label>Maintenance / announcement banner</Label>
          <Input value={v.maintenanceMessage} onChange={(e) => setV({ ...v, maintenanceMessage: e.target.value })} placeholder="Shown at the top of every page when set" />
        </div>
        <div className="space-y-1.5">
          <Label>Default terminal font size</Label>
          <Input type="number" min={10} max={24} value={v.defaultTerminalFontSize} onChange={(e) => setV({ ...v, defaultTerminalFontSize: Number(e.target.value) })} />
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />} Save settings
        </Button>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 font-semibold">Environment configuration</h2>
        <p className="mb-3 text-xs text-muted-foreground">Read-only values from the server environment (.env). Change them in the deployment configuration.</p>
        <dl className="space-y-2 text-sm">
          {[
            ["Environment", env.nodeEnv],
            ["Public URL", env.appUrl],
            ["Authentication", env.authProvider === "firebase" ? "Firebase Authentication" : "Local accounts"],
            ["Local password login", env.localAuth ? "enabled" : "disabled"],
            ["Redis", env.redis ? "connected (rate limiting)" : "not configured (in-memory rate limiting)"],
            ["Terminal rate limit", `${env.terminalRate} commands / minute / user`],
            ["Bootstrap admin emails", env.adminEmails || "—"],
          ].map(([k, val]) => (
            <div key={k} className="flex justify-between gap-4 border-b pb-2 last:border-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-mono text-xs">{val}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
